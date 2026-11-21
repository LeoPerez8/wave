import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  BrowserSignInError,
  signInWithBrowser,
  type BrowserSignInOptions,
} from "./browserSignIn.ts";

const base64url = (bytes: Buffer) => bytes.toString("base64url");
const idToken = (claims: Record<string, unknown>) =>
  `${base64url(Buffer.from('{"alg":"RS256"}'))}.${base64url(Buffer.from(JSON.stringify(claims)))}.sig`;

/** Google as the browser and the token endpoint see it: [answer] decides what the redirect carries. */
const google = (answer: (params: URLSearchParams) => Record<string, string>) => {
  const tokenCalls: URLSearchParams[] = [];
  let challenge = "";
  let page = "";
  const options: BrowserSignInOptions = {
    authUrl: "https://accounts.test/auth",
    tokenUrl: "https://oauth.test/token",
    clientId: "desktop-client",
    page: { title: "Back to Wave", message: "You can close this tab." },
    openExternal: async (url) => {
      const opened = new URL(url);
      assert.equal(opened.origin + opened.pathname, "https://accounts.test/auth");
      const params = opened.searchParams;
      challenge = params.get("code_challenge") ?? "";
      const redirect = new URL(params.get("redirect_uri") ?? "");
      for (const [key, value] of Object.entries(answer(params)))
        redirect.searchParams.set(key, value);
      // The browser follows the redirect a moment later, as a real one would.
      setTimeout(() => {
        void fetch(redirect).then(async (response) => {
          page = await response.text();
        });
      }, 5);
    },
    fetch: async (input, init) => {
      assert.equal(String(input), "https://oauth.test/token");
      const body = new URLSearchParams(String(init?.body));
      tokenCalls.push(body);
      const verifier = body.get("code_verifier") ?? "";
      if (base64url(createHash("sha256").update(verifier).digest()) !== challenge)
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      return Response.json({
        id_token: idToken({ email: "ana@example.com", name: "Ana", picture: "https://p.test/a" }),
      });
    },
  };
  return { options, tokenCalls, page: () => page };
};

const approve = (params: URLSearchParams) => ({
  code: "auth-code",
  state: params.get("state") ?? "",
});

test("Sign In opens Google with PKCE on a loopback address and comes back with the ID token", async () => {
  let opened: URLSearchParams | undefined;
  const fake = google((params) => {
    opened = params;
    return approve(params);
  });
  const result = await signInWithBrowser(fake.options);
  assert.ok(opened);
  assert.equal(opened.get("client_id"), "desktop-client");
  assert.equal(opened.get("response_type"), "code");
  assert.equal(opened.get("code_challenge_method"), "S256");
  assert.match(opened.get("scope") ?? "", /openid/);
  assert.match(opened.get("redirect_uri") ?? "", /^http:\/\/127\.0\.0\.1:\d+\/$/);
  assert.equal(fake.tokenCalls.length, 1);
  assert.equal(fake.tokenCalls[0]?.get("code"), "auth-code");
  assert.equal(fake.tokenCalls[0]?.get("redirect_uri"), opened.get("redirect_uri"));
  assert.equal(fake.tokenCalls[0]?.get("grant_type"), "authorization_code");
  assert.equal(result.name, "Ana");
  assert.equal(result.photoUrl, "https://p.test/a");
  assert.match(result.idToken, /\.sig$/);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match(fake.page(), /Back to Wave/);
});

test("a desktop client secret goes with the code when the build has one", async () => {
  const fake = google(approve);
  await signInWithBrowser({ ...fake.options, clientSecret: "not-really-secret" });
  assert.equal(fake.tokenCalls[0]?.get("client_secret"), "not-really-secret");
});

test("a redirect with another state is ignored, and the right one still signs in", async () => {
  const fake = google(approve);
  const opener = fake.options.openExternal;
  const result = await signInWithBrowser({
    ...fake.options,
    openExternal: async (url) => {
      const redirect = new URL(new URL(url).searchParams.get("redirect_uri") ?? "");
      redirect.searchParams.set("code", "forged");
      redirect.searchParams.set("state", "someone-else");
      assert.equal((await fetch(redirect)).status, 400);
      await opener(url);
    },
  });
  assert.equal(fake.tokenCalls.length, 1);
  assert.equal(fake.tokenCalls[0]?.get("code"), "auth-code");
  assert.ok(result.idToken);
});

test("backing out on Google's page is a cancelled sign-in", async () => {
  const fake = google((params) => ({ error: "access_denied", state: params.get("state") ?? "" }));
  await assert.rejects(signInWithBrowser(fake.options), (error: unknown) => {
    assert.ok(error instanceof BrowserSignInError);
    assert.equal(error.reason, "cancelled");
    return true;
  });
  assert.equal(fake.tokenCalls.length, 0);
});

test("Cancel in Wave stops waiting for the browser", async () => {
  const controller = new AbortController();
  const fake = google(approve);
  const signIn = signInWithBrowser({
    ...fake.options,
    signal: controller.signal,
    openExternal: async () => {
      controller.abort();
    },
  });
  await assert.rejects(
    signIn,
    (error: unknown) => (error as BrowserSignInError).reason === "cancelled",
  );
});

test("a browser that never comes back times out", async () => {
  const fake = google(approve);
  await assert.rejects(
    signInWithBrowser({ ...fake.options, timeoutMs: 30, openExternal: async () => {} }),
    (error: unknown) => (error as BrowserSignInError).reason === "timeout",
  );
});

test("a system browser that cannot open fails the sign-in without waiting for a callback", async () => {
  const fake = google(approve);
  await assert.rejects(
    signInWithBrowser({
      ...fake.options,
      openExternal: async () => {
        throw new Error("No browser");
      },
    }),
    (error: unknown) => (error as BrowserSignInError).reason === "failed",
  );
});

test("a token endpoint that refuses the code fails the sign-in", async () => {
  const fake = google(approve);
  await assert.rejects(
    signInWithBrowser({
      ...fake.options,
      fetch: async () => Response.json({ error: "invalid_grant" }, { status: 400 }),
    }),
    (error: unknown) => (error as BrowserSignInError).reason === "failed",
  );
});

test("a token endpoint out of reach is a network failure", async () => {
  const fake = google(approve);
  await assert.rejects(
    signInWithBrowser({
      ...fake.options,
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    }),
    (error: unknown) => (error as BrowserSignInError).reason === "network",
  );
});
