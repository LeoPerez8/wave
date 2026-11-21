import assert from "node:assert/strict";
import { test } from "node:test";
import type { WaveSession } from "@wave/core";
import { BrowserSignInError } from "./browserSignIn.ts";
import { sessionStore } from "./sessionStore.ts";
import { DESKTOP_CLIENT, desktop, keyring } from "./testAccount.ts";

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

test("Cancel while the service answers the sign-in signs nobody in", async () => {
  const app = await desktop();
  let reached = () => {};
  const atService = new Promise<void>((resolve) => (reached = resolve));
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  const account = app.open({
    // The service has the request and answers it only after Cancel.
    fetch: async (input, init) => {
      const response = await app.fetch(input, init);
      reached();
      await held;
      return response;
    },
  });
  const heard: WaveSession[] = [];
  account.subscribe((session) => heard.push(session));
  const signingIn = account.signIn();
  await atService;
  account.cancelSignIn();
  release();
  await signingIn;
  assert.deepEqual(account.view().account, { kind: "signedOut", action: "signIn", note: "about" });
  assert.deepEqual(heard, []);
  assert.equal(app.disk.size, 0);
  assert.deepEqual(app.open().view().account, {
    kind: "signedOut",
    action: "signIn",
    note: "about",
  });
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

test("Delete Account confirms with Google, deletes the account on the service and signs out", async () => {
  const app = await desktop();
  const account = app.open();
  await account.signIn();
  const phone = await app.service.signIn({ aud: DESKTOP_CLIENT });
  const heard: WaveSession[] = [];
  account.subscribe((session) => heard.push(session));
  const purposes: string[] = [];
  app.browser(async (_signal, purpose) => {
    purposes.push(purpose);
    return {
      idToken: await app.service.google.idToken({ aud: DESKTOP_CLIENT }),
      email: "ana@example.com",
      name: "Ana",
      photoUrl: null,
    };
  });

  await account.deleteAccount();

  // The tab Google sends back to says Wave is deleting, not signing in.
  assert.deepEqual(purposes, ["confirmDeletion"]);

  assert.deepEqual(account.view().account, {
    kind: "signedOut",
    action: "signIn",
    note: "deleted",
  });
  assert.deepEqual(heard, [{ status: "signedOut" }]);
  assert.equal(app.disk.size, 0);
  assert.equal((await app.service.request("GET", PULL, { session: phone })).status, 401);
  const accounts = await app.service.db.execute("SELECT COUNT(*) AS n FROM accounts");
  assert.equal(Number(accounts.rows[0]?.["n"]), 0);
});

const SIGNED_IN = {
  kind: "account",
  account: { email: "ana@example.com", name: "Ana", photoUrl: null },
  busy: null,
} as const;

/** The service still holds the account, and the desktop's session still works. */
const accountKept = async (app: Awaited<ReturnType<typeof desktop>>): Promise<void> => {
  const accounts = await app.service.db.execute("SELECT COUNT(*) AS n FROM accounts");
  assert.equal(Number(accounts.rows[0]?.["n"]), 1);
  assert.equal((await app.open().request("GET", PULL, null)).status, 200);
};

test("Delete Account with another Google account deletes nothing and says which to pick", async () => {
  const app = await desktop();
  const account = app.open();
  await account.signIn();
  app.browser(async () => ({
    idToken: await app.service.google.idToken({ aud: DESKTOP_CLIENT, sub: "google-sub-2" }),
    email: "bo@example.com",
    name: "Bo",
    photoUrl: null,
  }));

  await account.deleteAccount();

  assert.deepEqual(account.view().account, { ...SIGNED_IN, note: "wrongGoogleAccount" });
  await accountKept(app);
});

test("Delete Account offline keeps the account signed in and says why", async () => {
  const app = await desktop();
  const account = app.open();
  await account.signIn();
  app.offline();
  await account.deleteAccount();
  assert.deepEqual(account.view().account, { ...SIGNED_IN, note: "offline" });
  assert.equal(app.disk.size, 1);
});

test("Delete Account the service doesn't carry out keeps the account signed in and says so", async () => {
  const app = await desktop();
  const account = app.open({
    fetch: (input, init) =>
      init?.method === "DELETE"
        ? Promise.resolve(new Response("down", { status: 503 }))
        : app.fetch(input, init),
  });
  await account.signIn();
  await account.deleteAccount();
  assert.deepEqual(account.view().account, { ...SIGNED_IN, note: "failed" });
  await accountKept(app);
});

test("Cancel while Delete Account waits for the browser sends nothing", async () => {
  const app = await desktop();
  const account = app.open();
  await account.signIn();
  app.browser(
    (signal) =>
      new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(new BrowserSignInError("cancelled"))),
      ),
  );

  const deleting = account.deleteAccount();
  assert.deepEqual(account.view().account, { ...SIGNED_IN, busy: "deleting", note: null });
  account.cancelSignIn();
  await deleting;

  assert.deepEqual(account.view().account, { ...SIGNED_IN, note: null });
  await accountKept(app);
});

test("once the browser returns, Settings hears the deletion is on its way and Cancel changes nothing", async () => {
  const app = await desktop();
  let reached = () => {};
  const atService = new Promise<void>((resolve) => (reached = resolve));
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  const account = app.open({
    fetch: async (input, init) => {
      if (init?.method === "DELETE") {
        reached();
        await held;
      }
      return app.fetch(input, init);
    },
  });
  await account.signIn();
  let answer = () => {};
  const browser = new Promise<void>((resolve) => (answer = resolve));
  app.browser(async () => {
    await browser;
    return {
      idToken: await app.service.google.idToken({ aud: DESKTOP_CLIENT }),
      email: "ana@example.com",
      name: "Ana",
      photoUrl: null,
    };
  });

  const deleting = account.deleteAccount();
  assert.equal(account.view().deletionSent, false);
  answer();
  await atService;
  assert.equal(account.view().deletionSent, true);
  account.cancelSignIn();
  release();
  await deleting;

  assert.equal(account.view().deletionSent, false);
  assert.deepEqual(account.view().account, {
    kind: "signedOut",
    action: "signIn",
    note: "deleted",
  });
});

test("Delete Account on a session the service ended says the session ended", async () => {
  const app = await desktop();
  const account = app.open();
  await account.signIn();
  await app.service.db.execute("DELETE FROM sessions");

  await account.deleteAccount();

  assert.deepEqual(account.view().account, {
    kind: "signedOut",
    action: "signInAgain",
    note: "ended",
  });
});

test("signed out, Delete Account opens no browser and sends nothing", async () => {
  const app = await desktop();
  app.browser(() => assert.fail("the browser opened"));
  const account = app.open();
  await account.deleteAccount();
  assert.deepEqual(account.view().account, { kind: "signedOut", action: "signIn", note: "about" });
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

test("a show check's Ticketmaster routes go out with the session, and nothing else of theirs", async () => {
  const app = await desktop();
  const asked: string[] = [];
  const account = app.open({
    fetch: async (input, init) => {
      const url = String(input);
      if (!url.includes("/v1/ticketmaster/")) return app.fetch(input, init);
      asked.push(new URL(url).pathname + new URL(url).search);
      return new Response("{}", { status: 200 });
    },
  });
  await account.signIn();
  const routes = [
    "/v1/ticketmaster/attractions?keyword=Sigur%20R%C3%B3s",
    "/v1/ticketmaster/events?attractionId=K8vZ9171o-f&countryCode=BR",
  ];
  for (const path of routes)
    assert.deepEqual(await account.request("GET", path, null), { status: 200, body: "{}" });
  assert.deepEqual(asked, routes);
  for (const [method, path] of [
    ["POST", routes[0]!],
    ["GET", "/v1/ticketmaster/events?attractionId=../x&countryCode=BR"],
    ["GET", "/v1/ticketmaster/events?attractionId=K1&countryCode=BR&size=9"],
    ["GET", "/v1/ticketmaster/venues?keyword=x"],
  ] as const)
    await assert.rejects(account.request(method, path, null), {
      code: "ERR_WAVE_FORBIDDEN_REQUEST",
    });
});

test("Genius uses the Wave session and only the fixed Worker routes", async () => {
  const app = await desktop();
  const account = app.open();
  const search = "/v1/genius/search?q=Teardrop%20Massive%20Attack";
  await assert.rejects(account.request("GET", search, null), { code: "ERR_WAVE_SIGNED_OUT" });
  await account.signIn();
  for (const path of [search, "/v1/genius/song?id=9", "/v1/genius/referents?song=9&page=2"])
    assert.equal((await account.request("GET", path, null)).status, 200);
  for (const [method, path, body] of [
    ["POST", search, null],
    ["GET", search, "{}"],
    ["GET", "/v1/genius/search?q=a&q=b", null],
    ["GET", "/v1/genius/song?id=9#other", null],
    ["GET", "/v1/genius/referents?song=9&page=0", null],
  ] as const)
    await assert.rejects(account.request(method, path, body), {
      code: "ERR_WAVE_FORBIDDEN_REQUEST",
    });
  assert.deepEqual(
    app.service.upstream.calls.map(({ url }) => new URL(url).pathname),
    ["/search", "/songs/9", "/referents"],
  );
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
