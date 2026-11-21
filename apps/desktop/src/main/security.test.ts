import assert from "node:assert/strict";
import { test } from "node:test";
import {
  contentSecurityPolicy,
  guardWindow,
  windowWebPreferences,
  type GuardedContents,
} from "./security.ts";

const directives = (policy: string) =>
  new Map(
    policy
      .split(";")
      .map((part) => part.trim().split(/\s+/))
      .filter(([name]) => name !== undefined && name !== "")
      .map(([name, ...sources]) => [name, sources]),
  );

test("the built window runs only its own scripts and styles", () => {
  const policy = directives(contentSecurityPolicy(false));
  assert.deepEqual(policy.get("default-src"), ["'none'"]);
  assert.deepEqual(policy.get("script-src"), ["'self'"]);
  assert.deepEqual(policy.get("style-src"), ["'self'"]);
  assert.deepEqual(policy.get("object-src"), ["'none'"]);
  assert.deepEqual(policy.get("base-uri"), ["'none'"]);
  assert.deepEqual(policy.get("form-action"), ["'none'"]);
});

test("no policy lets the window evaluate strings as code", () => {
  for (const dev of [false, true]) assert.doesNotMatch(contentSecurityPolicy(dev), /unsafe-eval/);
});

test("the system media fallback can play only a local blob, never network audio", () => {
  assert.deepEqual(directives(contentSecurityPolicy(false)).get("media-src"), ["blob:"]);
});

test("the dev window may also reach Vite's server for hot reload", () => {
  const policy = directives(contentSecurityPolicy(true));
  assert.ok(policy.get("connect-src")?.includes("ws://localhost:*"));
  assert.ok(policy.get("script-src")?.includes("'self'"));
});

/** A window's events as Electron fires them, recording what Wave does with each. */
const fakeContents = () => {
  type Listener = (event: { preventDefault: () => void }, url: string) => void;
  type OpenHandler = (details: { url: string }) => { action: "allow" | "deny" };
  const listeners = new Map<string, Listener>();
  let openHandler: OpenHandler | undefined;
  const contents = {
    on: (name: string, listener: Listener) => void listeners.set(name, listener),
    setWindowOpenHandler: (handler: OpenHandler) => void (openHandler = handler),
  } as unknown as GuardedContents;
  const fire = (name: string, url = "") => {
    let prevented = false;
    listeners.get(name)?.({ preventDefault: () => void (prevented = true) }, url);
    return prevented;
  };
  const open = (url: string) => openHandler?.({ url }).action;
  return { contents, fire, open };
};

test("the window never navigates away from Wave; a followed web link opens in the browser", () => {
  const { contents, fire } = fakeContents();
  const opened: string[] = [];
  guardWindow(contents, (url) => opened.push(url));
  assert.equal(fire("will-navigate", "https://example.com/"), true);
  assert.equal(fire("will-navigate", "file:///C:/Windows/"), true);
  assert.equal(fire("will-redirect", "https://example.org/"), true);
  assert.equal(fire("will-attach-webview"), true);
  assert.deepEqual(opened, ["https://example.com/"]);
});

test("a web link opens in the system browser, and nothing opens inside Wave", () => {
  const { contents, open } = fakeContents();
  const opened: string[] = [];
  guardWindow(contents, (url) => opened.push(url));
  assert.equal(open("https://genius.com/song"), "deny");
  assert.equal(open("http://example.com/"), "deny");
  assert.equal(open("file:///C:/Windows/System32/cmd.exe"), "deny");
  assert.equal(open("javascript:alert(1)"), "deny");
  assert.equal(open("not a url"), "deny");
  assert.deepEqual(opened, ["https://genius.com/song", "http://example.com/"]);
});

test("every Wave window is sandboxed and isolated from its preload, with no Node in the page", () => {
  assert.deepEqual(windowWebPreferences("/wave/preload.cjs"), {
    preload: "/wave/preload.cjs",
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webviewTag: false,
    autoplayPolicy: "no-user-gesture-required",
  });
});
