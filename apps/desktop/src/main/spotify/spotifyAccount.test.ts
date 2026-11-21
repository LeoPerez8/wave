import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createSpotifyAccount, spotifySessionStore } from "./spotifyAccount.ts";

const photoUrl = "https://i.scdn.co/image/ana";
const account = { name: "Ana", photoUrl };
const accessToken = "fake-spotify-access-token";
const refreshToken = "fake-spotify-refresh-token";

const fakeSpotify = () => {
  let authorization: URL | undefined;
  let revoked = false;
  let now = 1_000;
  let refreshes = 0;
  const fetchSpotify: typeof fetch = async (input, init) => {
    switch (String(input)) {
      case "https://accounts.spotify.com/api/token": {
        const body = new URLSearchParams(String(init?.body));
        assert.equal(body.get("client_id"), "public-client");
        assert.equal(body.has("client_secret"), false);
        if (body.get("grant_type") === "refresh_token") {
          refreshes++;
          assert.equal(body.get("refresh_token"), refreshToken);
          return revoked
            ? Response.json({ error: "invalid_grant" }, { status: 400 })
            : Response.json({ access_token: accessToken, expires_in: 3600 });
        }
        assert.equal(body.get("grant_type"), "authorization_code");
        assert.equal(body.get("code"), "spotify-approved");
        const challenge = createHash("sha256")
          .update(body.get("code_verifier")!)
          .digest("base64url");
        assert.equal(authorization?.searchParams.get("code_challenge"), challenge);
        assert.equal(body.get("redirect_uri"), authorization?.searchParams.get("redirect_uri"));
        return Response.json({
          access_token: accessToken,
          refresh_token: refreshToken,
          expires_in: 3600,
        });
      }
      case "https://api.spotify.com/v1/me":
      case "https://api.spotify.com/v1/me/playlists":
        assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${accessToken}`);
        assert.equal(init?.redirect, "error");
        return revoked
          ? new Response(null, { status: 401 })
          : Response.json({ id: "ana", display_name: "Ana", images: [{ url: photoUrl }] });
      default:
        assert.fail(`Unexpected request to ${String(input)}`);
    }
  };
  const browser = async (url: string) => {
    authorization = new URL(url);
    assert.equal(
      authorization.origin + authorization.pathname,
      "https://accounts.spotify.com/authorize",
    );
    assert.equal(authorization.searchParams.get("response_type"), "code");
    assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
    const callback = new URL(authorization.searchParams.get("redirect_uri")!);
    assert.match(callback.href, /^http:\/\/127\.0\.0\.1:\d+\/spotify\/callback$/);
    callback.searchParams.set("state", authorization.searchParams.get("state")!);
    callback.searchParams.set("code", "spotify-approved");
    assert.equal((await fetch(callback)).status, 200);
  };
  return {
    fetch: fetchSpotify,
    browser,
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
    revoke: () => {
      revoked = true;
    },
    refreshes: () => refreshes,
  };
};

const fakeStore = (keyring = "gnome_libsecret") => {
  const files = new Map<string, Buffer>();
  const sealed = new Map<Buffer, string>();
  return {
    files,
    store: () =>
      spotifySessionStore({
        platform: "linux",
        file: "spotify-session.bin",
        files: {
          read: (path) => files.get(path),
          write: (path, bytes) => {
            files.set(path, bytes);
          },
          remove: (path) => {
            files.delete(path);
          },
        },
        box: {
          getSelectedStorageBackend: () => keyring,
          isEncryptionAvailable: () => true,
          encryptString: (text) => {
            const bytes = Buffer.from("sealed by the fake keyring");
            sealed.set(bytes, text);
            return bytes;
          },
          decryptString: (bytes) => sealed.get(bytes)!,
        },
      }),
    decrypted: () => [...files.values()].map((bytes) => sealed.get(bytes)!).join(),
  };
};

const fixture = (keyring?: string) => {
  const spotify = fakeSpotify();
  const disk = fakeStore(keyring);
  const start = () =>
    createSpotifyAccount({
      clientId: "public-client",
      store: disk.store(),
      openExternal: spotify.browser,
      fetch: spotify.fetch,
      online: () => true,
      now: spotify.now,
      page: () => ({ title: "Back to Wave", message: "You can close this tab." }),
    });
  return { spotify, disk, start };
};

test("Spotify sign-in uses PKCE and gives Settings only the display profile", async () => {
  const { start } = fixture();
  const spotify = start();
  assert.equal(spotify.session().status, "signedOut");
  await spotify.signIn();
  assert.deepEqual(spotify.view().account, { kind: "account", action: "signOut", account });
  assert.deepEqual(spotify.session(), { status: "signedIn", account });
});

test("a saved Spotify session survives restart and refreshes once across concurrent requests", async () => {
  const fixtureWithKeyring = fixture();
  const first = fixtureWithKeyring.start();
  await first.signIn();
  const bytes = fixtureWithKeyring.disk.files.get("spotify-session.bin");
  assert.ok(bytes);
  assert.equal(bytes.includes(accessToken), false);
  assert.equal(bytes.includes(refreshToken), false);
  assert.match(fixtureWithKeyring.disk.decrypted(), /fake-spotify-refresh-token/);
  first.dispose();

  const restarted = fixtureWithKeyring.start();
  assert.deepEqual(restarted.session(), { status: "signedIn", account });
  assert.equal((await restarted.request("/v1/me/playlists")).status, "response");
  fixtureWithKeyring.spotify.advance(3_600_000);
  const results = await Promise.all([
    restarted.request("/v1/me/playlists"),
    restarted.request("/v1/me/playlists"),
  ]);
  assert.deepEqual(
    results.map((result) => result.status),
    ["response", "response"],
  );
  assert.equal(fixtureWithKeyring.spotify.refreshes(), 1);
});

test("a revoked grant clears the tokens and offers Sign In Again after a restart", async () => {
  const { start, spotify, disk } = fixture();
  const signedIn = start();
  await signedIn.signIn();
  spotify.revoke();
  await signedIn.check();
  assert.deepEqual(signedIn.view().account, {
    kind: "signedOut",
    action: "signInAgain",
    note: "expired",
  });
  assert.equal((await signedIn.request("/v1/me/playlists")).status, "expired");
  assert.doesNotMatch(disk.decrypted(), /fake-spotify-(access|refresh)-token/);
  assert.equal(start().session().status, "expired");
});

test("Sign Out removes the saved session, and Linux basic_text never saves a token", async () => {
  const withKeyring = fixture();
  const signedIn = withKeyring.start();
  await signedIn.signIn();
  signedIn.signOut();
  assert.equal(withKeyring.disk.files.size, 0);
  assert.equal(withKeyring.start().session().status, "signedOut");
  assert.equal((await signedIn.request("/v1/me/playlists")).status, "signedOut");

  const withoutKeyring = fixture("basic_text");
  const temporary = withoutKeyring.start();
  await temporary.signIn();
  assert.equal(temporary.view().keyringMissing, true);
  assert.equal(temporary.session().status, "signedIn");
  assert.equal(withoutKeyring.disk.files.size, 0);
  assert.equal(withoutKeyring.start().session().status, "signedOut");
});
