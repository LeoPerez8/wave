import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeTrack } from "@wave/core";
import { openTestDatabase } from "./testDatabase.ts";
import { desktopScanIndex } from "./desktopScan.ts";
import { trackQuery } from "./tracks.ts";
import { setFavorites, listFavorites, recordPlay, latestPlay } from "./playHistory.ts";
import { createPlaylist, appendPlaylistSongs, selectPlaylistEntries } from "./playlists.ts";

const song = (path: string) => ({
  ...normalizeTrack({ path, title: "Pink Moon", artist: "Nick Drake", durationMs: 124000 }),
  sizeBytes: 100,
  modifiedAt: 1,
  sampleRate: null,
  bitrateKbps: null,
  artworkHash: null,
  hasLyrics: false,
  explicit: "unknown" as const,
});

test("a Windows case-only rename updates the same starred song", async () => {
  const db = await openTestDatabase();
  const index = desktopScanIndex(db, "win32");
  index.begin([{ path: "C:/Music", available: true }], ["C:/Music/One.flac"]);
  index.save([song("C:/Music/One.flac")]);
  index.finish();
  const original = trackQuery(db).all()[0]!;
  setFavorites(db, [original.id], true, 10);
  index.begin([{ path: "C:/Music", available: true }], ["c:/music/ONE.flac"]);
  index.save([song("c:/music/ONE.flac")]);
  index.finish();
  assert.equal(trackQuery(db).all()[0]!.id, original.id);
  assert.equal(listFavorites(db)[0]!.path, "c:/music/ONE.flac");
  assert.equal(trackQuery(db).all().length, 1);
});

test("an unplugged root keeps song ids, stars and playlist places, then returns", async () => {
  const db = await openTestDatabase();
  const index = desktopScanIndex(db, "win32");
  const present = [{ path: "D:/Music", available: true }];
  index.begin(present, ["D:/Music/One.flac"]);
  index.save([song("D:/Music/One.flac")]);
  index.finish();
  const id = trackQuery(db).all()[0]!.id;
  setFavorites(db, [id], true, 10);
  recordPlay(db, {
    trackId: String(id),
    startedAt: 10,
    durationMs: 124000,
    listenedMs: 124000,
    counted: true,
    endReason: "completed",
    source: "desktop",
    context: { kind: "allSongs", id: null },
  });
  const playlist = createPlaylist(db, "Evening", [], 10).playlistId;
  appendPlaylistSongs(db, playlist, [{ source: "library", trackId: id }], 10);
  index.begin([{ path: "D:/Music", available: false }], []);
  index.finish();
  assert.equal(index.unavailable("d:/MUSIC/One.flac"), true);
  assert.equal(listFavorites(db)[0]!.id, id);
  assert.equal(selectPlaylistEntries(db, playlist).length, 1);
  assert.equal(latestPlay(db)?.play.trackId, String(id));
  index.begin(present, ["D:/Music/One.flac"]);
  index.finish();
  assert.equal(index.unavailable("D:/Music/One.flac"), false);
  assert.equal(trackQuery(db).all()[0]!.id, id);
  index.begin(present, []);
  index.finish();
  assert.equal(trackQuery(db).all().length, 0);
});

test("a root lost during tag reading cannot delete the songs discovery did not find", async () => {
  const db = await openTestDatabase();
  const index = desktopScanIndex(db, "linux");
  index.begin([{ path: "/Music", available: true }], ["/Music/One.flac"]);
  index.save([song("/Music/One.flac")]);
  index.finish();
  index.begin([{ path: "/Music", available: true }], []);
  index.finish([{ path: "/Music", available: false }]);
  assert.equal(trackQuery(db).all().length, 1);
  assert.equal(index.unavailable("/Music/One.flac"), true);
});

test("voice notes are remembered unread and indexed music that becomes a recording leaves", async () => {
  const db = await openTestDatabase();
  const index = desktopScanIndex(db, "linux");
  const roots = [{ path: "/Music", available: true }];
  index.begin(roots, ["/Music/One.flac"]);
  index.save([song("/Music/One.flac")]);
  index.finish();
  index.begin(roots, ["/Music/One.flac"]);
  index.skip([{ path: "/Music/One.flac", sizeBytes: 101, modifiedAt: 2 }]);
  index.finish();
  assert.equal(trackQuery(db).all().length, 0);
  assert.deepEqual(index.skipped(), [{ path: "/Music/One.flac", sizeBytes: 101, modifiedAt: 2 }]);
  index.begin(roots, []);
  index.finish();
  assert.deepEqual(index.skipped(), []);
});
