import assert from "node:assert/strict";
import { test } from "node:test";
import { findSignInBrowser } from "./signInBrowser.ts";

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

const linux = (installed: readonly string[], path = "/usr/local/bin:/usr/bin:/snap/bin") =>
  findSignInBrowser({
    platform: "linux",
    env: { PATH: path },
    exists: (file) => installed.includes(file),
  });

test("on Linux the sign-in browser is the first Chromium-family one on the PATH", () => {
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
