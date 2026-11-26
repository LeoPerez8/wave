import type { WaveSession } from "@wave/core";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { SecretBox, SessionFiles } from "../account/sessionStore.ts";
import { createYtAccount } from "./ytAccount.ts";
import type { YtBrowserOutcome } from "./ytBrowserSignIn.ts";
import { createYtSessions, ytSessionStore } from "./ytSessionStore.ts";

const keyring: SecretBox = {
  isEncryptionAvailable: () => true,
  encryptString: (text) => Buffer.from([...Buffer.from(text, "utf8")].reverse()),
  decryptString: (bytes) => Buffer.from([...bytes].reverse()).toString("utf8"),
};

const ACCOUNT = { name: "Ana", email: "ana@example.com", photoUrl: null };
// A made-up cookie under the names YouTube's have: no account's.
const COOKIE = "SAPISID=fake-value; SID=fake-other";
const READ: YtBrowserOutcome = {
  kind: "signedIn",
  cookie: COOKIE,
  dataSyncId: "111||222",
  sessionIndex: "0",
};
const fail = (code: string) => Object.assign(new Error(code), { code });

/**
 * Wave's YouTube account over a JVM that keeps its session with main, as `WaveDesktop` does,
 * and a browser sign-in that ends as the test says.
 */
const desktop = (options: { readonly box?: SecretBox; readonly disk?: Map<string, Buffer> }) => {
  const disk = options.disk ?? new Map<string, Buffer>();
  const files: SessionFiles = {
    read: (path) => disk.get(path),
    write: (path, bytes) => void disk.set(path, bytes),
    remove: (path) => void disk.delete(path),
  };
  const sessions = createYtSessions(
    ytSessionStore({ box: options.box ?? keyring, file: "yt.bin", files, platform: "win32" }),
  );
  const calls: { method: string; params: unknown }[] = [];
  const world = {
    online: true,
    enabled: true,
    cancelled: 0,
    browsers: 0,
    /** What YouTube answers the JVM; a code fails the call. */
    youtube: "ok" as "ok" | "ERR_YT_OFFLINE" | "ERR_YT_FAILED" | "ERR_YT_SIGNED_OUT",
    library: [
      { playlistId: "PL1", title: "Road", artworkUrl: null, songCount: 12, kind: "own" },
      { playlistId: "LM", title: "Liked Music", artworkUrl: null, songCount: 3, kind: "generated" },
      {
        playlistId: "RDTMAK",
        title: "Supermix",
        artworkUrl: null,
        songCount: null,
        kind: "generated",
      },
      {
        playlistId: "PL2",
        title: "Saved",
        artworkUrl: "https://img.test/a",
        songCount: null,
        kind: "saved",
      },
    ] as unknown,
    closeWindow: (_outcome: YtBrowserOutcome) => {},
    /** Tells YT Music's account of a Wave account session change, as `account.subscribe` does. */
    wave: (_session: WaveSession) => {},
  };
  const save = (session: unknown) => sessions.host["ytSession.save"]!({ session });
  const account = createYtAccount({
    sessions,
    enabled: () => world.enabled,
    online: () => world.online,
    waveSessions: (listener) => {
      world.wave = listener;
      return () => (world.wave = () => {});
    },
    startSignIn: () => {
      world.browsers += 1;
      let end = (_outcome: YtBrowserOutcome) => {};
      const outcome = new Promise<YtBrowserOutcome>((resolve) => (end = resolve));
      world.closeWindow = end;
      return {
        outcome,
        cancel: () => {
          world.cancelled += 1;
          end({ kind: "cancelled" });
        },
      };
    },
    call: (async (method: string, params: unknown) => {
      calls.push({ method, params });
      if (method === "ytSignOut") {
        await save(null);
        return { status: "signedOut" };
      }
      if (world.youtube !== "ok") {
        if (world.youtube === "ERR_YT_SIGNED_OUT" && method !== "ytSignIn")
          await save({ expired: true, account: ACCOUNT });
        throw fail(world.youtube);
      }
      if (method === "ytSignIn") {
        const { cookie } = params as { cookie: string };
        await save({ cookie, dataSyncId: "111", authUser: "0", account: ACCOUNT });
        return { status: "signedIn", account: ACCOUNT };
      }
      if (method === "ytCheckSession") return { status: "signedIn", account: ACCOUNT };
      if (method === "libraryPlaylists") return world.library;
      throw fail("ERR_UNKNOWN_METHOD");
    }) as never,
  });
  return { account, world, calls, disk };
};

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("Sign In opens the browser, and what it read signs YT Music in", async () => {
  const { account, world, calls, disk } = desktop({});
  assert.deepEqual(account.view(), {
    account: { kind: "signedOut", action: "signIn", note: "optional" },
    keyringMissing: false,
    noBrowser: false,
  });
  const signingIn = account.signIn();
  assert.equal(
    account.view().account?.kind === "signedOut" && account.view().account?.action,
    "signingIn",
  );
  world.closeWindow(READ);
  await signingIn;
  assert.deepEqual(calls, [
    { method: "ytSignIn", params: { cookie: COOKIE, dataSyncId: "111||222", sessionIndex: "0" } },
  ]);
  assert.deepEqual(account.view().account, {
    kind: "account",
    account: ACCOUNT,
    action: "signOut",
  });
  assert.ok(!disk.get("yt.bin")!.toString("utf8").includes("fake-value"));
});

test("the view never carries the cookie", async () => {
  const { account, world } = desktop({});
  const signingIn = account.signIn();
  world.closeWindow(READ);
  await signingIn;
  assert.ok(!JSON.stringify(account.view()).includes("fake"));
});

test("a session read without the channel's id signs in without it", async () => {
  const { account, world, calls } = desktop({});
  const signingIn = account.signIn();
  world.closeWindow({ ...READ, dataSyncId: null });
  await signingIn;
  assert.deepEqual(calls[0]?.params, { cookie: COOKIE, sessionIndex: "0" });
});

test("after a restart the account is there at once, and YouTube is asked about it once", async () => {
  const first = desktop({});
  const signingIn = first.account.signIn();
  first.world.closeWindow(READ);
  await signingIn;
  const second = desktop({ disk: first.disk });
  assert.deepEqual(second.account.view().account, {
    kind: "account",
    account: ACCOUNT,
    action: "signOut",
  });
  second.account.view();
  await settle();
  assert.deepEqual(
    second.calls.map((call) => call.method),
    ["ytCheckSession"],
  );
});

test("a session YouTube ended shows Sign In Again", async () => {
  const first = desktop({});
  const signingIn = first.account.signIn();
  first.world.closeWindow(READ);
  await signingIn;
  const second = desktop({ disk: first.disk });
  second.world.youtube = "ERR_YT_SIGNED_OUT";
  second.account.view();
  await settle();
  assert.deepEqual(second.account.view().account, {
    kind: "signedOut",
    action: "signInAgain",
    note: "expired",
  });
});

test("closing the window without signing in, or Cancel, leaves the account as it was", async () => {
  const { account, world, calls } = desktop({});
  const closed = account.signIn();
  world.closeWindow({ kind: "closed" });
  await closed;
  assert.deepEqual(account.view().account, {
    kind: "signedOut",
    action: "signIn",
    note: "optional",
  });
  const cancelled = account.signIn();
  account.cancelSignIn();
  await cancelled;
  assert.equal(world.cancelled, 1);
  assert.deepEqual(account.view().account, {
    kind: "signedOut",
    action: "signIn",
    note: "optional",
  });
  assert.deepEqual(calls, []);
});

test("without a browser to sign in with, the view says so until the next Sign In", async () => {
  const { account, world } = desktop({});
  const first = account.signIn();
  world.closeWindow({ kind: "noBrowser" });
  await first;
  assert.equal(account.view().noBrowser, true);
  assert.deepEqual(account.view().account, {
    kind: "signedOut",
    action: "signIn",
    note: "optional",
  });
  const second = account.signIn();
  assert.equal(account.view().noBrowser, false);
  world.closeWindow({ kind: "closed" });
  await second;
});

test("a sign-in that didn't work says why", async () => {
  const { account, world } = desktop({});
  const failed = account.signIn();
  world.closeWindow({ kind: "failed" });
  await failed;
  assert.deepEqual(account.view().account, { kind: "signedOut", action: "signIn", note: "failed" });

  world.youtube = "ERR_YT_FAILED";
  const refused = account.signIn();
  world.closeWindow(READ);
  await refused;
  assert.deepEqual(account.view().account, { kind: "signedOut", action: "signIn", note: "failed" });

  world.youtube = "ERR_YT_OFFLINE";
  const unreachable = account.signIn();
  world.closeWindow(READ);
  await unreachable;
  assert.deepEqual(account.view().account, {
    kind: "signedOut",
    action: "signIn",
    note: "offline",
  });

  world.online = false;
  const before = world.browsers;
  await account.signIn();
  assert.equal(world.browsers, before, "offline, no browser opens");
  assert.deepEqual(account.view().account, {
    kind: "signedOut",
    action: "signIn",
    note: "offline",
  });
});

test("a second Sign In while the browser is open opens no second browser", async () => {
  const { account, world } = desktop({});
  const first = account.signIn();
  const second = account.signIn();
  assert.equal(world.browsers, 1);
  world.closeWindow({ kind: "closed" });
  await Promise.all([first, second]);
});

test("turning YT Music off blocks sign-in and discards a session returned by an open browser", async () => {
  const { account, world, calls } = desktop({});
  const signingIn = account.signIn();
  world.enabled = false;
  world.closeWindow(READ);
  await signingIn;

  const disabled = account.signIn();
  world.closeWindow({ kind: "closed" });
  await disabled;
  assert.equal(world.browsers, 1);
  assert.deepEqual(calls, []);
});

test("Sign Out forgets the session, here and in the file", async () => {
  const { account, world, disk } = desktop({});
  const signingIn = account.signIn();
  world.closeWindow(READ);
  await signingIn;
  await account.signOut();
  assert.equal(disk.size, 0);
  assert.deepEqual(account.view().account, {
    kind: "signedOut",
    action: "signIn",
    note: "optional",
  });
});

test("without a keyring the session is never written, and Settings says so", async () => {
  const { account, world, disk } = desktop({
    box: { ...keyring, isEncryptionAvailable: () => false },
  });
  const signingIn = account.signIn();
  world.closeWindow(READ);
  await signingIn;
  assert.equal(disk.size, 0);
  assert.equal(account.view().keyringMissing, true);
  assert.equal(account.view().account?.kind, "account");
});

test("with YT Music off there is no Sign In, but a signed-in account can still sign out", async () => {
  const { account, world } = desktop({});
  world.enabled = false;
  assert.equal(account.view().account, null);
  world.enabled = true;
  const signingIn = account.signIn();
  world.closeWindow(READ);
  await signingIn;
  world.enabled = false;
  assert.equal(account.view().account?.kind, "account");
});

test("the account's playlists list Liked Songs first and leave out what YouTube generates", async () => {
  const { account, world } = desktop({});
  const signingIn = account.signIn();
  world.closeWindow(READ);
  await signingIn;
  assert.deepEqual(await account.playlists("en"), {
    status: "ok",
    playlists: [
      { playlistId: "LM", title: "Liked Songs", artworkUrl: null, line: "3 songs" },
      { playlistId: "PL1", title: "Road", artworkUrl: null, line: "12 songs" },
      { playlistId: "PL2", title: "Saved", artworkUrl: "https://img.test/a", line: null },
    ],
  });
});

test("playlists that can't be read say why", async () => {
  const { account, world, calls } = desktop({});
  assert.equal((await account.playlists("en")).status, "failed", "signed out");
  assert.deepEqual(calls, [], "signed out, YouTube isn't asked");
  const signingIn = account.signIn();
  world.closeWindow(READ);
  await signingIn;
  world.youtube = "ERR_YT_FAILED";
  const failed = await account.playlists("en");
  assert.equal(failed.status === "failed" && failed.action, "tryAgain");
  world.youtube = "ERR_YT_SIGNED_OUT";
  const ended = await account.playlists("en");
  assert.equal(ended.status === "failed" && ended.action, "signIn");
  assert.equal(account.view().account?.kind, "signedOut", "the JVM said the session ended");
});

const WAVE: WaveSession = {
  status: "signedIn",
  account: { email: "ana@example.com", name: "Ana", photoUrl: null },
};

test("a Wave account sign-in opens YT Music's sign-in next, when it's on and signed out", async () => {
  const { account, world, calls } = desktop({});
  world.wave(WAVE);
  assert.equal(world.browsers, 1);
  assert.equal(
    account.view().account?.kind === "signedOut" && account.view().account?.action,
    "signingIn",
  );
  // Sign In pressed meanwhile waits for the same browser.
  const pressed = account.signIn();
  world.closeWindow(READ);
  await pressed;
  assert.equal(world.browsers, 1);
  assert.deepEqual(
    calls.map(({ method }) => method),
    ["ytSignIn"],
  );
  assert.deepEqual(account.view().account, {
    kind: "account",
    account: ACCOUNT,
    action: "signOut",
  });
});

test("closing the window the Wave sign-in opened leaves YT Music signed out with nothing new", async () => {
  const { account, world, calls } = desktop({});
  world.wave(WAVE);
  world.closeWindow({ kind: "closed" });
  await settle();
  assert.deepEqual(calls, []);
  assert.deepEqual(account.view(), {
    account: { kind: "signedOut", action: "signIn", note: "optional" },
    keyringMissing: false,
    noBrowser: false,
  });
});

test("Cancel stops the YT Music sign-in a Wave sign-in opened", async () => {
  const { account, world } = desktop({});
  world.wave(WAVE);
  account.cancelSignIn();
  await settle();
  assert.equal(world.cancelled, 1);
  assert.deepEqual(account.view().account, {
    kind: "signedOut",
    action: "signIn",
    note: "optional",
  });
});

test("a Wave sign-out or ended session, YT Music off, or a YouTube account kept opens nothing", async () => {
  const { account, world } = desktop({});
  world.wave({ status: "signedOut" });
  world.wave({ status: "ended", account: null });
  world.enabled = false;
  world.wave(WAVE);
  assert.equal(world.browsers, 0);

  world.enabled = true;
  const signingIn = account.signIn();
  world.closeWindow(READ);
  await signingIn;
  world.wave(WAVE);
  assert.equal(world.browsers, 1);
});

test("once disposed, a Wave sign-in opens nothing", () => {
  const { account, world } = desktop({});
  account.dispose();
  world.wave(WAVE);
  assert.equal(world.browsers, 0);
});
