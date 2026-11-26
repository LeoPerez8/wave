import assert from "node:assert/strict";
import { test } from "node:test";
import type { CdpSocket } from "./cdp.ts";
import {
  startYtBrowserSignIn,
  ytCookieHeader,
  YT_SIGN_IN_URL,
  type CdpCookie,
} from "./ytBrowserSignIn.ts";

const BROWSER = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PROFILE = "C:\\wave\\yt-sign-in-1";

// Made-up values under the names YouTube's cookies have: no account's.
const cookie = (name: string, domain = ".youtube.com", value = `fake-${name}`): CdpCookie => ({
  name,
  value,
  domain,
});
const SIGNED_IN = [cookie("SAPISID"), cookie("__Secure-3PAPISID"), cookie("SID")];
const SIGNED_OUT = [cookie("VISITOR_INFO1_LIVE"), cookie("YSC")];

interface Config {
  readonly loaded: boolean;
  readonly dataSyncId: string | null;
  readonly sessionIndex: string;
}
const LOADED: Config = { loaded: true, dataSyncId: "111||222", sessionIndex: "0" };

interface Spawned {
  readonly path: string;
  readonly args: readonly string[];
  killed: boolean;
  readonly exit: () => void;
}

/**
 * A Chromium-family browser as Wave drives it: a window the owner closes, then a headless run
 * that answers the DevTools protocol. [config] is the page's config at each read, from 0.
 */
const browser = (page: {
  readonly cookies: readonly CdpCookie[];
  readonly config?: (read: number) => Config;
  /** False: the headless run never says where its DevTools port is. */
  readonly port?: boolean;
  readonly userAgent?: string;
  readonly email?: string;
}) => {
  const spawned: Spawned[] = [];
  const disk = new Map<string, string>();
  const removed: string[] = [];
  const sent: { method: string; params: Record<string, unknown>; sessionId?: string }[] = [];
  const connected: string[] = [];
  let time = 0;
  let reads = 0;
  const answer = (method: string): unknown => {
    switch (method) {
      case "Browser.getVersion":
        return {
          userAgent: page.userAgent ?? "Mozilla/5.0 HeadlessChrome/141.0.0.0 Safari/537.36",
        };
      case "Target.getTargets":
        return { targetInfos: [{ targetId: "page-1", type: "page" }] };
      case "Target.attachToTarget":
        return { sessionId: "session-1" };
      case "Runtime.evaluate":
        return {
          result: { value: JSON.stringify((page.config ?? (() => LOADED))(reads++)) },
        };
      case "Storage.getCookies":
        return { cookies: page.cookies };
      case "Browser.close":
        spawned.at(-1)?.exit();
        return {};
      default:
        return {};
    }
  };
  const run = startYtBrowserSignIn({
    browser: BROWSER,
    email: page.email ?? null,
    spawn: (path, args) => {
      let exit = () => {};
      const exited = new Promise<"exited">((resolve) => (exit = () => resolve("exited")));
      const child: Spawned = { path, args, killed: false, exit };
      spawned.push(child);
      if (args.includes("--headless=new") && page.port !== false)
        disk.set(`${PROFILE}\\DevToolsActivePort`, "51234\n/devtools/browser/abc\n");
      return {
        exited,
        kill: () => {
          child.killed = true;
          exit();
        },
      };
    },
    files: {
      makeProfile: () => PROFILE,
      read: (path) => disk.get(path),
      remove: async (folder) => void removed.push(folder),
      join: (...parts) => parts.join("\\"),
    },
    connect: (url) => {
      connected.push(url);
      const listeners = new Map<string, ((event: { data?: unknown }) => void)[]>();
      const emit = (type: string, event: { data?: unknown } = {}) => {
        for (const listener of listeners.get(type) ?? []) listener(event);
      };
      queueMicrotask(() => emit("open"));
      return {
        addEventListener: (type, listener) =>
          void listeners.set(type, [...(listeners.get(type) ?? []), listener]),
        send: (text) => {
          const message = JSON.parse(text) as {
            id: number;
            method: string;
            params?: Record<string, unknown>;
            sessionId?: string;
          };
          sent.push({
            method: message.method,
            params: message.params ?? {},
            ...(message.sessionId === undefined ? {} : { sessionId: message.sessionId }),
          });
          const result = answer(message.method);
          queueMicrotask(() =>
            emit("message", { data: JSON.stringify({ id: message.id, result }) }),
          );
        },
        close: () => emit("close"),
      } satisfies CdpSocket;
    },
    now: () => time,
    // Time passes at once, a turn of the event loop per wait.
    wait: async (ms) => {
      time += ms;
      await new Promise((resolve) => setImmediate(resolve));
    },
  });
  /** Lets what is pending run, as far as it goes without the owner. */
  const settle = async () => {
    for (let turn = 0; turn < 50; turn++) await new Promise((resolve) => setImmediate(resolve));
  };
  return { run, spawned, removed, sent, connected, settle, elapsed: () => time };
};

test("the owner signs in in a plain browser window, and a headless run reads the session", async () => {
  const chrome = browser({ cookies: [...SIGNED_IN, cookie("NID", ".google.com")] });
  await chrome.settle();
  assert.equal(chrome.spawned.length, 1, "nothing else starts while the window is open");
  const window = chrome.spawned[0]!;
  assert.equal(window.path, BROWSER);
  assert.deepEqual(window.args, [
    `--user-data-dir=${PROFILE}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--new-window",
    YT_SIGN_IN_URL,
  ]);
  assert.equal(
    YT_SIGN_IN_URL,
    "https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fmusic.youtube.com",
  );
  window.exit();
  assert.deepEqual(await chrome.run.outcome, {
    kind: "signedIn",
    cookie: "SAPISID=fake-SAPISID; __Secure-3PAPISID=fake-__Secure-3PAPISID; SID=fake-SID",
    dataSyncId: "111||222",
    sessionIndex: "0",
  });
  const headless = chrome.spawned[1]!;
  assert.deepEqual(headless.args, [
    `--user-data-dir=${PROFILE}`,
    "--headless=new",
    "--remote-debugging-port=0",
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ]);
  assert.deepEqual(chrome.connected, ["ws://127.0.0.1:51234/devtools/browser/abc"]);
  assert.equal(chrome.spawned.length, 2);
  assert.equal(chrome.sent.at(-1)?.method, "Browser.close", "the headless browser is closed");
  assert.deepEqual(chrome.removed, [PROFILE], "the profile is deleted");
});

test("the window the owner signs in in is never started with a debugging port", async () => {
  const chrome = browser({ cookies: SIGNED_IN });
  await chrome.settle();
  for (const arg of chrome.spawned[0]!.args) {
    assert.doesNotMatch(arg, /remote-debugging|headless|enable-automation/);
  }
  chrome.run.cancel();
  await chrome.run.outcome;
});

test("the headless run reads YouTube Music as a browser with a window would", async () => {
  const chrome = browser({ cookies: SIGNED_IN });
  await chrome.settle();
  chrome.spawned[0]!.exit();
  await chrome.run.outcome;
  const methods = chrome.sent.map((message) => message.method);
  const agent = chrome.sent.find((message) => message.method === "Emulation.setUserAgentOverride");
  assert.equal(agent?.params["userAgent"], "Mozilla/5.0 Chrome/141.0.0.0 Safari/537.36");
  assert.equal(agent?.sessionId, "session-1");
  const navigate = chrome.sent.find((message) => message.method === "Page.navigate");
  assert.equal(navigate?.params["url"], "https://music.youtube.com/");
  assert.ok(
    methods.indexOf("Emulation.setUserAgentOverride") < methods.indexOf("Page.navigate"),
    "the user agent is set before the page loads",
  );
});

test("closing the window without signing in ends as closed, and the profile is deleted", async () => {
  const chrome = browser({ cookies: SIGNED_OUT });
  await chrome.settle();
  chrome.spawned[0]!.exit();
  assert.deepEqual(await chrome.run.outcome, { kind: "closed" });
  assert.equal(chrome.sent.at(-1)?.method, "Browser.close");
  assert.deepEqual(chrome.removed, [PROFILE]);
});

test("the channel's id is waited for when the page gives it late", async () => {
  const chrome = browser({
    cookies: SIGNED_IN,
    config: (read) =>
      read < 2
        ? { loaded: false, dataSyncId: null, sessionIndex: "0" }
        : read < 5
          ? { loaded: true, dataSyncId: null, sessionIndex: "0" }
          : { loaded: true, dataSyncId: "333||", sessionIndex: "2" },
  });
  await chrome.settle();
  chrome.spawned[0]!.exit();
  const outcome = await chrome.run.outcome;
  assert.equal(outcome.kind, "signedIn");
  assert.equal(outcome.kind === "signedIn" && outcome.dataSyncId, "333||");
  assert.equal(outcome.kind === "signedIn" && outcome.sessionIndex, "2");
});

test("a page that never gives the channel's id still signs in, without it", async () => {
  const chrome = browser({
    cookies: SIGNED_IN,
    config: () => ({ loaded: true, dataSyncId: null, sessionIndex: "0" }),
  });
  await chrome.settle();
  chrome.spawned[0]!.exit();
  const outcome = await chrome.run.outcome;
  assert.equal(outcome.kind === "signedIn" && outcome.dataSyncId, null);
  assert.ok(chrome.elapsed() >= 5_000, "it was waited for");
  assert.ok(chrome.elapsed() <= 40_000, "not for ever");
});

test("a page that never loads its config signs in with the cookies alone, in the end", async () => {
  const chrome = browser({
    cookies: SIGNED_IN,
    config: () => ({ loaded: false, dataSyncId: null, sessionIndex: "0" }),
  });
  await chrome.settle();
  chrome.spawned[0]!.exit();
  const outcome = await chrome.run.outcome;
  assert.equal(outcome.kind === "signedIn" && outcome.dataSyncId, null);
  assert.ok(chrome.elapsed() <= 40_000);
});

test("Cancel while the window is open closes it, deletes the profile and reads nothing", async () => {
  const chrome = browser({ cookies: SIGNED_IN });
  await chrome.settle();
  chrome.run.cancel();
  assert.deepEqual(await chrome.run.outcome, { kind: "cancelled" });
  assert.equal(chrome.spawned.length, 1);
  assert.equal(chrome.spawned[0]!.killed, true);
  assert.deepEqual(chrome.removed, [PROFILE]);
  assert.deepEqual(chrome.sent, []);
});

test("Cancel while the session is read stops the headless browser too", async () => {
  const chrome = browser({
    cookies: SIGNED_IN,
    config: () => ({ loaded: false, dataSyncId: null, sessionIndex: "0" }),
  });
  await chrome.settle();
  chrome.spawned[0]!.exit();
  // Far enough for the headless browser to have started.
  await new Promise((resolve) => setImmediate(resolve));
  chrome.run.cancel();
  assert.deepEqual(await chrome.run.outcome, { kind: "cancelled" });
  assert.equal(chrome.spawned.length, 2);
  assert.deepEqual(chrome.removed, [PROFILE]);
});

test("a headless run that never opens its DevTools port fails, and the profile is deleted", async () => {
  const chrome = browser({ cookies: SIGNED_IN, port: false });
  await chrome.settle();
  chrome.spawned[0]!.exit();
  assert.deepEqual(await chrome.run.outcome, { kind: "failed" });
  assert.ok(chrome.spawned.slice(1).every((child) => child.killed));
  assert.deepEqual(chrome.removed, [PROFILE]);
});

test("without a browser nothing starts", async () => {
  let spawned = 0;
  const run = startYtBrowserSignIn({
    browser: null,
    spawn: () => {
      spawned += 1;
      throw new Error("no browser to start");
    },
    files: {
      makeProfile: () => assert.fail("no profile is made"),
      read: () => undefined,
      remove: async () => {},
      join: (...parts) => parts.join("/"),
    },
    connect: () => assert.fail("nothing to connect to"),
  });
  assert.deepEqual(await run.outcome, { kind: "noBrowser" });
  assert.equal(spawned, 0);
});

test("a browser that doesn't start fails", async () => {
  const removed: string[] = [];
  const run = startYtBrowserSignIn({
    browser: BROWSER,
    spawn: () => ({ exited: Promise.resolve("failed"), kill: () => {} }),
    files: {
      makeProfile: () => PROFILE,
      read: () => undefined,
      remove: async (folder) => void removed.push(folder),
      join: (...parts) => parts.join("\\"),
    },
    connect: () => assert.fail("nothing to connect to"),
  });
  assert.deepEqual(await run.outcome, { kind: "failed" });
  assert.deepEqual(removed, [PROFILE]);
});

test("browser errors report failure without logging details from the browser", async () => {
  const logs: string[] = [];
  const run = startYtBrowserSignIn({
    browser: BROWSER,
    spawn: () => {
      throw new Error("browser returned a private account detail");
    },
    files: {
      makeProfile: () => PROFILE,
      read: () => undefined,
      remove: async () => {},
      join: (...parts) => parts.join("/"),
    },
    connect: () => assert.fail("nothing to connect to"),
    log: (line) => logs.push(line),
  });
  assert.deepEqual(await run.outcome, { kind: "failed" });
  assert.deepEqual(logs, ["YouTube sign-in failed"]);
});

test("the cookie header holds what music.youtube.com gets, each name once", () => {
  assert.equal(
    ytCookieHeader([
      cookie("SID", ".youtube.com", "a"),
      cookie("NID", ".google.com", "b"),
      cookie("PREF", "music.youtube.com", "c"),
      cookie("OTHER", "studio.youtube.com", "d"),
      cookie("EVIL", "notyoutube.com", "e"),
      { ...cookie("PART", ".youtube.com", "f"), partitionKey: { topLevelSite: "https://x.test" } },
      cookie("SID", "www.youtube.com", "g"),
    ]),
    "SID=a; PREF=c",
  );
});

test("the browser opens Google's sign-in with the suggested email", async () => {
  const chrome = browser({ cookies: SIGNED_OUT, email: "ana.souza+wave@example.com" });
  await chrome.settle();
  assert.equal(
    chrome.spawned[0]?.args.at(-1),
    "https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fmusic.youtube.com&Email=ana.souza%2Bwave%40example.com",
  );
  chrome.run.cancel();
  await chrome.run.outcome;
});
