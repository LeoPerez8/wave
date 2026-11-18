import assert from "node:assert/strict";
import { test } from "node:test";
import { scanPath, scanPathKey, scanFileState } from "./desktopScan.ts";
import { planAddRoot, planExclusion } from "./scanRoots.ts";

test("desktop paths use slashes without losing drive and network roots", () => {
  assert.equal(scanPath("C:\\Music\\Album\\..\\Song.flac", "win32"), "C:/Music/Song.flac");
  assert.equal(scanPath("C:\\", "win32"), "C:/");
  assert.equal(scanPath("\\\\server\\share\\Music\\", "win32"), "//server/share/Music");
  assert.equal(scanPath("\\\\server\\share\\..\\Song.flac", "win32"), "//server/share/Song.flac");
  assert.equal(scanPath("/home/me/Music/./", "linux"), "/home/me/Music");
  assert.equal(scanPathKey("C:\\MUSIC\\Song.FLAC", "win32"), "c:/music/song.flac");
  assert.notEqual(scanPathKey("/Music/A.flac", "linux"), scanPathKey("/Music/a.flac", "linux"));
});

test("a Windows drive root covers its folders in shared root and exclusion plans", () => {
  assert.deepEqual(planAddRoot([{ path: "c:/", isDefault: false, trackCount: 1 }], "c:/music"), {
    kind: "covered",
    by: "c:/",
  });
  assert.deepEqual(planExclusion(["c:/"], [], "c:/music"), { kind: "add", drop: [] });
});

test("only absent files under a readable root leave; unavailable roots keep their songs", () => {
  const roots = [
    { path: "D:/Music", available: false },
    { path: "C:/Music", available: true },
  ];
  assert.equal(scanFileState("D:/Music/One.flac", roots, new Set(), "win32"), "unavailable");
  assert.equal(scanFileState("C:/Music/Gone.flac", roots, new Set(), "win32"), "missing");
  assert.equal(
    scanFileState("c:/MUSIC/One.flac", roots, new Set(["c:/music/one.flac"]), "win32"),
    "present",
  );
  assert.equal(scanFileState("C:/Music2/One.flac", roots, new Set(), "win32"), "outside");
  assert.equal(
    scanFileState("C:/One.flac", [{ path: "C:/", available: true }], new Set(), "win32"),
    "missing",
  );
});
