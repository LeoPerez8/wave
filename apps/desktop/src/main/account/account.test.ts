import assert from "node:assert/strict";
import { test } from "node:test";
import type { WaveSession } from "@wave/core";
import { harness, type Harness, type HarnessOptions } from "../../../../sync/src/testing.ts";
import { createWaveAccount, type WaveAccountDeps } from "./account.ts";
import { BrowserSignInError, type BrowserIdentity } from "./browserSignIn.ts";
import { sessionStore, type SecretBox, type SessionFiles } from "./sessionStore.ts";

const SYNC_URL = "https://sync.wave.test";
const DESKTOP_CLIENT = "wave-desktop-client.apps.googleusercontent.com";

const keyring: SecretBox = {
  isEncryptionAvailable: () => true,
  encryptString: (text) => Buffer.from([...Buffer.from(text, "utf8")].reverse()),
  decryptString: (bytes) => Buffer.from([...bytes].reverse()).toString("utf8"),
};

/** `fetch` as the desktop sends it, answered by the harness's service. */
const viaService =
  (service: Harness): typeof fetch =>
  async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, SYNC_URL);
    const headers = Object.fromEntries(new Headers(init?.headers));
    const body = typeof init?.body === "string" ? init.body : undefined;
    return service.request(init?.method ?? "GET", url.pathname + url.search, {
      headers,
      ...(body === undefined ? {} : { body }),
    });
  };

/** The desktop app over a fresh service, with a browser that signs in as [claims] says. */
const desktop = async (options: HarnessOptions = {}) => {
  const service = await harness({ googleDesktopClientId: DESKTOP_CLIENT, ...options });
  const disk = new Map<string, Buffer>();
  const files: SessionFiles = {
    read: (path) => disk.get(path),
    write: (path, bytes) => void disk.set(path, bytes),
    remove: (path) => void disk.delete(path),
  };
  let browser = async (): Promise<BrowserIdentity> => ({
    idToken: await service.google.idToken({ aud: DESKTOP_CLIENT, name: "Ana" }),
    email: "ana@example.com",
    name: "Ana",
    photoUrl: null,
  });
  let online = true;
  let fetch = viaService(service);
  const open = (overrides: Partial<WaveAccountDeps> = {}) =>
    createWaveAccount({
      store: sessionStore({ box: keyring, file: "session.bin", files, platform: "win32" }),
      syncUrl: SYNC_URL,
      signInWithBrowser: (signal) => browser(signal),
      fetch: (input, init) => fetch(input, init),
      online: () => online,
      ...overrides,
    });
  return {
    service,
    disk,
    open,
    browser: (next: (signal: AbortSignal) => Promise<BrowserIdentity>) => void (browser = next),
    offline: () => {
      online = false;
      fetch = async () => {
        throw new TypeError("fetch failed");
      };
    },
  };
};

const PULL = "/v1/pull";

test("signing in through the browser keeps the session, encrypted, across a restart", async () => {
  const app = await desktop();
  const account = app.open();
  assert.deepEqual(account.view().account, { kind: "signedOut", action: "signIn", note: "about" });
  const heard: WaveSession[] = [];
  account.subscribe((session) => heard.push(session));

  await account.signIn();

  const signedIn = {
    kind: "account",
    account: { email: "ana@example.com", name: "Ana", photoUrl: null },
    busy: null,
    note: null,
  };
  assert.deepEqual(account.view().account, signedIn);
  assert.deepEqual(
    heard.map((session) => session.status),
    ["signedIn"],
  );
  assert.ok(!app.disk.get("session.bin")!.toString("utf8").includes("ana@example.com"));
  const restarted = app.open();
  assert.deepEqual(restarted.view().account, signedIn);
  assert.equal((await restarted.request("GET", PULL, null)).status, 200);
});

for (const [why, options, note] of [
  ["the email isn't on the allowlist", { allowedEmails: "bo@example.com" }, "notAllowed"],
  ["the service holds all its accounts", { limits: { maxAccounts: 0 } }, "accountsFull"],
  [
    "the service made all its new accounts today",
    { limits: { maxNewAccountsPerDay: 0 } },
    "newAccountsPaused",
  ],
] as const)
  test(`when ${why}, Settings says so and nothing is kept`, async () => {
    const app = await desktop(options);
    const account = app.open();
    await account.signIn();
    assert.deepEqual(account.view().account, { kind: "signedOut", action: "signIn", note });
    assert.equal(app.disk.size, 0);
  });

test("Cancel stops waiting for the browser and leaves no note", async () => {
  const app = await desktop();
  app.browser(
    (signal) =>
      new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(new BrowserSignInError("cancelled"))),
      ),
  );
  const account = app.open();
  const signingIn = account.signIn();
  assert.deepEqual(account.view().account, {
    kind: "signedOut",
    action: "signingIn",
    note: "about",
  });
  account.cancelSignIn();
  await signingIn;
  assert.deepEqual(account.view().account, { kind: "signedOut", action: "signIn", note: "about" });
});

test("signing in with no network says Wave is offline", async () => {
  const app = await desktop();
  app.offline();
  const account = app.open();
  await account.signIn();
  assert.deepEqual(account.view().account, {
    kind: "signedOut",
    action: "signIn",
    note: "offline",
  });
});

test("a session the service ended (401) shows as ended, and the sync is told", async () => {
  const app = await desktop();
  const account = app.open();
  await account.signIn();
  const heard: WaveSession[] = [];
  account.subscribe((session) => heard.push(session));
  // Every session of the account ends elsewhere (another device's Sign Out on All Devices).
  const phone = await app.service.signIn({ aud: DESKTOP_CLIENT });
  await app.service.request("DELETE", "/v1/sessions", { session: phone });

  await assert.rejects(account.request("GET", PULL, null), { code: "ERR_WAVE_SESSION_ENDED" });

  assert.deepEqual(account.view().account, {
    kind: "signedOut",
    action: "signInAgain",
    note: "ended",
  });
  assert.deepEqual(
    heard.map((session) => session.status),
    ["ended"],
  );
  assert.deepEqual(app.open().view().account, {
    kind: "signedOut",
    action: "signInAgain",
    note: "ended",
  });
});

test("Sign Out ends the session on the service and forgets it here", async () => {
  const app = await desktop();
  const account = app.open();
  await account.signIn();
  const before = account.request("GET", PULL, null);
  assert.equal((await before).status, 200);
  const disk = new Map(app.disk);

  await account.signOut();

  assert.equal(app.disk.size, 0);
  assert.deepEqual(account.view().account, { kind: "signedOut", action: "signIn", note: "about" });
  await assert.rejects(account.request("GET", PULL, null), { code: "ERR_WAVE_SIGNED_OUT" });
  // The token kept before signing out no longer works.
  for (const [path, bytes] of disk) app.disk.set(path, bytes);
  await assert.rejects(app.open().request("GET", PULL, null), { code: "ERR_WAVE_SESSION_ENDED" });
});

test("Sign Out on All Devices ends the phone's session too", async () => {
  const app = await desktop();
  const account = app.open();
  await account.signIn();
  const phone = await app.service.signIn({ aud: DESKTOP_CLIENT });

  await account.signOutEverywhere();

  assert.deepEqual(account.view().account, {
    kind: "signedOut",
    action: "signIn",
    note: "signedOutEverywhere",
  });
  assert.equal((await app.service.request("GET", PULL, { session: phone })).status, 401);
});

test("Sign Out on All Devices offline keeps the session and says why", async () => {
  const app = await desktop();
  const account = app.open();
  await account.signIn();
  app.offline();
  await account.signOutEverywhere();
  assert.deepEqual(account.view().account, {
    kind: "account",
    account: { email: "ana@example.com", name: "Ana", photoUrl: null },
    busy: null,
    note: "signOutEverywhereOffline",
  });
});

test("a build with no sync service has no Sign In, and sends nothing", async () => {
  const app = await desktop();
  const account = app.open({ syncUrl: null });
  await account.signIn();
  assert.deepEqual(account.view().account, { kind: "unavailable" });
  await assert.rejects(account.request("GET", PULL, null), { code: "ERR_WAVE_SIGNED_OUT" });
});

test("only pushes and pulls go out with the session", async () => {
  const app = await desktop();
  const account = app.open();
  await account.signIn();
  for (const [method, path] of [
    ["GET", "/v1/soulseek"],
    ["POST", "/v1/pull"],
    ["GET", "/v1/pull?since=../x"],
  ] as const)
    await assert.rejects(account.request(method, path, null), {
      code: "ERR_WAVE_FORBIDDEN_REQUEST",
    });
});

test("without a keyring, Settings says the session lasts until Wave quits", async () => {
  const app = await desktop();
  const account = app.open({
    store: sessionStore({
      box: { ...keyring, isEncryptionAvailable: () => false },
      file: "session.bin",
      files: { read: () => undefined, write: () => assert.fail("written"), remove: () => {} },
      platform: "linux",
    }),
  });
  await account.signIn();
  assert.equal(account.view().keyringMissing, true);
  assert.equal(account.view().account.kind, "account");
});
