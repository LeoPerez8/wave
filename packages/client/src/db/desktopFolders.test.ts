import assert from "node:assert/strict";
import { test } from "node:test";
import { openTestDatabase } from "./testDatabase.ts";
import { normalizeTrack } from "@wave/core";
import { desktopScanIndex } from "./desktopScan.ts";
import { desktopFolders, desktopRoots } from "./desktopFolders.ts";
import { ensureDefaultRoot, excludedFolders } from "./libraryQueries.ts";

test("Windows folder settings count drive-root songs and compare paths without case", async () => {
  const db = await openTestDatabase();
  ensureDefaultRoot(db, "C:/");
  const index = desktopScanIndex(db, "win32");
  index.begin([{ path: "C:/", available: true }], ["c:/MUSIC/One.flac"]);
  index.save([
    {
      ...normalizeTrack({ path: "c:/MUSIC/One.flac", title: "One" }),
      sizeBytes: 100,
      modifiedAt: 1,
      sampleRate: null,
      bitrateKbps: null,
      artworkHash: null,
      hasLyrics: false,
      explicit: "unknown",
    },
  ]);
  index.finish();
  const folders = desktopFolders(db, "win32");
  assert.equal(desktopRoots(db, "win32")[0]!.trackCount, 1);
  folders.add("c:/music");
  assert.equal(desktopRoots(db, "win32").length, 1);
  folders.exclude("c:/MUSIC");
  assert.deepEqual(excludedFolders(db), ["c:/MUSIC"]);
  folders.include("C:/music");
  assert.deepEqual(excludedFolders(db), []);
  assert.throws(() => folders.exclude("D:/Music"), /outside/);
  assert.throws(() => folders.remove("c:/"), /at least one/);
});
