import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultBrowserCommand, findSignInBrowser, signInProfileRoot } from "./signInBrowser.ts";

const windows = (installed: readonly string[]) =>
  findSignInBrowser({
    platform: "win32",
    env: {
      ProgramFiles: "C:\\Program Files",
      "ProgramFiles(x86)": "C:\\Program Files (x86)",
      LOCALAPPDATA: "C:\\Users\\ana\\AppData\\Local",
    },
    exists: (path) => installed.includes(path),
  });

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

test("on Windows the sign-in browser is Chrome where it is installed, else Edge", () => {
  assert.equal(windows([EDGE, CHROME]), CHROME);
  assert.equal(windows([EDGE]), EDGE);
});

test("on Windows a browser installed for one user only is found too", () => {
  const brave =
    "C:\\Users\\ana\\AppData\\Local\\BraveSoftware\\Brave-Browser\\Application\\brave.exe";
  assert.equal(windows([brave]), brave);
  const chromium = "C:\\Users\\ana\\AppData\\Local\\Chromium\\Application\\chrome.exe";
  assert.equal(windows([chromium]), chromium);
});

const linux = (
  installed: readonly string[],
  path = "/usr/local/bin:/usr/bin:/snap/bin",
  wrappers: readonly string[] = [],
  preferred?: string,
) =>
  findSignInBrowser({
    platform: "linux",
    env: { PATH: path },
    exists: (file) => installed.includes(file),
    isChromiumSnapWrapper: (file) => wrappers.includes(file),
    ...(preferred === undefined ? {} : { preferred }),
  });

test("on Linux the sign-in browser is an installed Chromium-family browser", () => {
  assert.equal(linux(["/usr/bin/chromium", "/usr/bin/firefox"]), "/usr/bin/chromium");
  assert.equal(linux(["/usr/bin/microsoft-edge"]), "/usr/bin/microsoft-edge");
  assert.equal(linux(["/usr/bin/brave-browser"]), "/usr/bin/brave-browser");
  assert.equal(linux(["/snap/bin/chromium", "/usr/bin/google-chrome"]), "/usr/bin/google-chrome");
});

test("without a Chromium-family browser there is none", () => {
  assert.equal(windows([]), null);
  assert.equal(linux(["/usr/bin/firefox"]), null);
  assert.equal(linux(["/usr/bin/chromium"], ""), null);
  assert.equal(
    findSignInBrowser({ platform: "linux", env: {}, exists: () => true }),
    null,
    "no PATH, nowhere to look",
  );
});

test("Linux prefers browser family across PATH and treats a Chromium Snap wrapper as confined", () => {
  assert.equal(
    linux(["/usr/local/bin/chromium", "/usr/bin/google-chrome"]),
    "/usr/bin/google-chrome",
  );
  const wrapper = "/usr/bin/chromium-browser";
  const snap = "/var/lib/snapd/snap/bin/chromium";
  assert.equal(linux([wrapper, snap], "/usr/bin", [wrapper]), snap);
  assert.equal(linux([wrapper], "/usr/bin", [wrapper]), null);
  assert.equal(linux([wrapper, snap], "/usr/bin"), wrapper);
  assert.equal(
    signInProfileRoot(snap, "/home/ana", "/home/ana/.config/Wave"),
    "/home/ana/snap/chromium/common",
  );
  assert.equal(
    signInProfileRoot(wrapper, "/home/ana", "/home/ana/.config/Wave"),
    "/home/ana/.config/Wave",
  );
});

test("the default browser's family is tried first on Linux when it is Chromium-family", () => {
  const chrome = "/usr/bin/google-chrome";
  const brave = "/usr/bin/brave-browser";
  // Chrome wins by default, but the user's Brave default moves Brave ahead of it.
  assert.equal(linux([chrome, brave]), chrome);
  assert.equal(linux([chrome, brave], undefined, [], "brave-browser"), brave);
  // A default that isn't installed just leaves the normal order.
  assert.equal(linux([chrome, brave], undefined, [], "chromium"), chrome);
  // A default Wave doesn't know (undefined from the mapping) changes nothing.
  assert.equal(linux([chrome, brave], undefined, [], undefined), chrome);
});

test("defaultBrowserCommand maps a .desktop name to a sign-in command, else undefined", () => {
  assert.equal(defaultBrowserCommand("brave-browser.desktop"), "brave-browser");
  assert.equal(defaultBrowserCommand("brave_brave.desktop"), "brave-browser");
  assert.equal(defaultBrowserCommand("google-chrome.desktop"), "google-chrome");
  assert.equal(defaultBrowserCommand("microsoft-edge.desktop"), "microsoft-edge");
  assert.equal(defaultBrowserCommand("chromium_chromium.desktop"), "chromium");
  assert.equal(defaultBrowserCommand("chromium.desktop\n"), "chromium");
  assert.equal(defaultBrowserCommand("firefox.desktop"), undefined);
  assert.equal(defaultBrowserCommand(undefined), undefined);
  assert.equal(defaultBrowserCommand(""), undefined);
});
