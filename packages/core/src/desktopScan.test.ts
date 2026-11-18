import assert from "node:assert/strict";
import { test } from "node:test";
import { scanPath, scanPathKey, scanFileState } from "./desktopScan.ts";

test("desktop paths use slashes without losing drive and network roots", () => {
  assert.equal(scanPath("C:\\Music\\Album\\..\\Song.flac", "win32"), "C:/Music/Song.flac");
  assert.equal(scanPath("C:\\", "win32"), "C:/");
  assert.equal(scanPath("\\\\server\\share\\Music\\", "win32"), "//server/share/Music");
  assert.equal(scanPath("/home/me/Music/./", "linux"), "/home/me/Music");
  assert.equal(scanPathKey("C:\\MUSIC\\Song.FLAC", "win32"), "c:/music/song.flac");
  assert.notEqual(scanPathKey("/Music/A.flac", "linux"), scanPathKey("/Music/a.flac", "linux"));
});

test("only absent files under a readable root leave; unavailable roots keep their songs", () => {
  const roots = [{ path: "D:/Music", available: false }, { path: "C:/Music", available: true }];
  assert.equal(scanFileState("D:/Music/One.flac", roots, new Set(), "win32"), "unavailable");
  assert.equal(scanFileState("C:/Music/Gone.flac", roots, new Set(), "win32"), "missing");
  assert.equal(scanFileState("c:/MUSIC/One.flac", roots, new Set(["c:/music/one.flac"]), "win32"), "present");
  assert.equal(scanFileState("C:/Music2/One.flac", roots, new Set(), "win32"), "outside");
  assert.equal(scanFileState("C:/One.flac", [{ path: "C:/", available: true }], new Set(), "win32"), "missing");
});
