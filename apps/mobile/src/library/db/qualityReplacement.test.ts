/// <reference types="node" />
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import { normalizeTrack } from "@wave/core";
import { eq } from "drizzle-orm";

import type { IndexedTrack } from "../LibraryStore.ts";
import { creditSplits } from "./credits.ts";
import { selectMissingSongs } from "./missingSongs.ts";
import { selectFavoriteTrackIds, setFavorites } from "./playHistory.ts";
import { forgetFileDeletions, pendingFileDeletions } from "./fileDeletions.ts";
import { createPlaylist } from "./playlists.ts";
import {
  rememberNoBetterCopies,
  replaceTrackFile,
  selectNoBetterCopies,
  selectQualityFiles,
  selectReplacedTrack,
} from "./qualityReplacement.ts";
import { saveBatch } from "./save.ts";
import * as schema from "./schema.ts";
import { addMissingSong, openTestDatabase, type TestDatabase } from "./testDatabase.ts";
import { deleteTracksById } from "./tracks.ts";

let db: TestDatabase;

beforeEach(async () => {
  db = await openTestDatabase();
});

const file = (path: string, patch: Partial<IndexedTrack> = {}): IndexedTrack => ({
  ...normalizeTrack({
    path,
    title: "Get Lucky",
    artist: "Daft Punk",
    album: "Random Access Memories",
    durationMs: 248_000,
  }),
  sizeBytes: 3_968_000,
  modifiedAt: 0,
  sampleRate: 44_100,
  bitrateKbps: 128,
  artworkHash: null,
  hasLyrics: true,
  explicit: "clean",
  ...patch,
});

const save = (tracks: readonly IndexedTrack[]) => saveBatch(db, creditSplits(), tracks, [], [], 1);

const idOf = (path: string): number =>
  db.select({ id: schema.tracks.id }).from(schema.tracks).where(eq(schema.tracks.path, path)).get()!
    .id;

const songs = () =>
  db
    .select({
      id: schema.tracks.id,
      path: schema.tracks.path,
      bitrateKbps: schema.tracks.bitrateKbps,
      recordingKey: schema.tracks.recordingKey,
    })
    .from(schema.tracks)
    .all();

const OLD = "/Music/Daft Punk/Random Access Memories/08 Get Lucky.m4a";
const NEW = "/Music/Daft Punk/Random Access Memories/08 Get Lucky.mp3";

describe("the files a quality replacement looks at", () => {
  test("every file with its length, bitrate and size; missing songs have none", () => {
    save([file(OLD), file("/Music/b.flac", { bitrateKbps: null, sizeBytes: 30_000_000 })]);
    addMissingSong(db, { title: "Lucky" });
    assert.deepEqual(
      selectQualityFiles(db).map((song) => [
        song.path,
        song.durationMs,
        song.bitrateKbps,
        song.sizeBytes,
      ]),
      [
        [OLD, 248_000, 128, 3_968_000],
        ["/Music/b.flac", 248_000, null, 30_000_000],
      ],
    );
  });

  test("a YouTube download's file carries its video, which tells the bitrate YouTube gives", () => {
    save([file(OLD, { videoId: "abc" }), file("/Music/b.mp3", { bitrateKbps: 320 })]);
    assert.deepEqual(
      selectQualityFiles(db).map((song) => [song.path, song.videoId]),
      [
        [OLD, "abc"],
        ["/Music/b.mp3", null],
      ],
    );
  });

  test("remembers the songs with no better copy, each way on its own, once", () => {
    save([file(OLD), file("/Music/b.mp3")]);
    const [a, b] = [idOf(OLD), idOf("/Music/b.mp3")];
    rememberNoBetterCopies(db, [
      { direction: "upgrade", trackId: a },
      { direction: "upgrade", trackId: a },
      { direction: "downgrade", trackId: b },
    ]);
    assert.deepEqual(selectNoBetterCopies(db, "upgrade"), [a]);
    assert.deepEqual(selectNoBetterCopies(db, "downgrade"), [b]);
  });

  test("a song a replacement is asked for comes with its tags, cover and file", () => {
    db.insert(schema.artwork)
      .values({ hash: "cover", path: "/art/cover.jpg", thumbPath: "/art/cover_t.jpg", palette: {} })
      .run();
    save([file(OLD, { artworkHash: "cover", explicit: "explicit" })]);
    const track = selectReplacedTrack(db, idOf(OLD));
    assert.equal(track?.path, OLD);
    assert.equal(track?.title, "Get Lucky");
    assert.deepEqual(track?.artists, ["Daft Punk"]);
    assert.equal(track?.album, "Random Access Memories");
    assert.equal(track?.albumArtist, "Daft Punk");
    assert.equal(track?.artworkPath, "/art/cover.jpg");
    assert.equal(track?.explicit, "explicit");
    assert.equal(selectReplacedTrack(db, 999), null);
  });
});

describe("replacing a Track's file in place", () => {
  test("the new file takes over the Track: same id, star, playlist entries and recording key", () => {
    save([file(OLD)]);
    const id = idOf(OLD);
    const key = songs()[0]?.recordingKey;
    setFavorites(db, [id], true, 1);
    const { playlistId } = createPlaylist(db, "Disco", [{ source: "library", trackId: id }], 1);
    // Tags that would key it apart (a "(feat.)" title) don't make it another song.
    const replaced = replaceTrackFile(
      db,
      creditSplits(),
      id,
      file(NEW, { title: "Get Lucky (feat. Pharrell)", bitrateKbps: 320, sizeBytes: 9_920_000 }),
      [],
      2,
    );
    assert.deepEqual(replaced, { kind: "replaced", oldPath: OLD, starred: [] });
    assert.deepEqual(songs(), [{ id, path: NEW, bitrateKbps: 320, recordingKey: key }]);
    assert.deepEqual(selectFavoriteTrackIds(db), [id]);
    assert.deepEqual(
      db
        .select({ trackId: schema.playlistItems.trackId })
        .from(schema.playlistItems)
        .where(eq(schema.playlistItems.playlistId, playlistId))
        .all(),
      [{ trackId: id }],
    );
  });

  test("YouTube Music's copy freeing space gives the Track its video", () => {
    save([file(NEW, { bitrateKbps: 320, sizeBytes: 9_920_000 })]);
    const id = idOf(NEW);
    replaceTrackFile(db, creditSplits(), id, file(OLD, { videoId: "xyz" }), [], 2);
    assert.deepEqual(
      selectQualityFiles(db).map((song) => [song.id, song.path, song.bitrateKbps, song.videoId]),
      [[id, OLD, 128, "xyz"]],
    );
  });

  test("a new file at the old one's very path updates the Track", () => {
    save([file(NEW)]);
    const id = idOf(NEW);
    const replaced = replaceTrackFile(
      db,
      creditSplits(),
      id,
      file(NEW, { bitrateKbps: 320 }),
      [],
      2,
    );
    assert.deepEqual(replaced, { kind: "replaced", oldPath: NEW, starred: [] });
    assert.deepEqual(
      songs().map((song) => [song.id, song.path, song.bitrateKbps]),
      [[id, NEW, 320]],
    );
  });

  test("a scan that indexed the new file first doesn't leave a second song", () => {
    save([file(OLD)]);
    const id = idOf(OLD);
    save([file(NEW, { bitrateKbps: 320 })]);
    replaceTrackFile(db, creditSplits(), id, file(NEW, { bitrateKbps: 320 }), [], 2);
    assert.deepEqual(
      songs().map((song) => [song.id, song.path]),
      [[id, NEW]],
    );
  });

  test("a Track removed meanwhile is gone, and nothing is saved", () => {
    save([file(OLD)]);
    assert.deepEqual(replaceTrackFile(db, creditSplits(), 999, file(NEW), [], 2), { kind: "gone" });
    assert.deepEqual(
      songs().map((song) => song.path),
      [OLD],
    );
  });

  test("a missing song isn't replaced: it has no file", () => {
    const id = addMissingSong(db, { title: "Lucky" });
    assert.deepEqual(replaceTrackFile(db, creditSplits(), id, file(NEW), [], 2), { kind: "gone" });
    assert.equal(selectMissingSongs(db).length, 1);
  });

  test("the memory of no better copy goes with its Track", () => {
    save([file(OLD)]);
    const id = idOf(OLD);
    rememberNoBetterCopies(db, [{ direction: "upgrade", trackId: id }]);
    deleteTracksById(db, [id]);
    assert.deepEqual(selectNoBetterCopies(db, "upgrade"), []);
  });
});

describe("the old file's recorded deletion", () => {
  test("the swap records that the old file must go, in its transaction", () => {
    save([file(OLD)]);
    replaceTrackFile(db, creditSplits(), idOf(OLD), file(NEW, { bitrateKbps: 320 }), [], 2);
    assert.deepEqual(pendingFileDeletions(db), [OLD]);
  });

  test("a new file at the old one's very path leaves nothing to delete", () => {
    save([file(NEW)]);
    replaceTrackFile(db, creditSplits(), idOf(NEW), file(NEW, { bitrateKbps: 320 }), [], 2);
    assert.deepEqual(pendingFileDeletions(db), []);
  });

  test("a replayed import after the swap still finds the old file to delete", () => {
    save([file(OLD)]);
    const id = idOf(OLD);
    replaceTrackFile(db, creditSplits(), id, file(NEW, { bitrateKbps: 320 }), [], 2);
    // Killed before the old file was deleted: the journal asks for the import again.
    const replayed = replaceTrackFile(
      db,
      creditSplits(),
      id,
      file(NEW, { bitrateKbps: 320 }),
      [],
      3,
    );
    assert.equal(replayed.kind === "replaced" && replayed.oldPath, NEW);
    assert.deepEqual(pendingFileDeletions(db), [OLD]);
  });

  test("a deletion done, or a file already missing, is cleared", () => {
    save([file(OLD)]);
    replaceTrackFile(db, creditSplits(), idOf(OLD), file(NEW, { bitrateKbps: 320 }), [], 2);
    forgetFileDeletions(db, [OLD]);
    assert.deepEqual(pendingFileDeletions(db), []);
  });

  test("a recorded file a Track holds is a Library song's: never deleted, its record goes", () => {
    save([file(OLD)]);
    const id = idOf(OLD);
    replaceTrackFile(db, creditSplits(), id, file(NEW, { bitrateKbps: 320 }), [], 2);
    // Say a Track came to hold that path again (a replacement back the other way).
    replaceTrackFile(db, creditSplits(), id, file(OLD), [], 3);
    assert.deepEqual(pendingFileDeletions(db), [NEW]);
  });

  test("a Track removed before its new file arrived leaves the new file to delete", () => {
    save([file(OLD)]);
    const id = idOf(OLD);
    deleteTracksById(db, [id]);
    assert.deepEqual(replaceTrackFile(db, creditSplits(), id, file(NEW), [], 2), { kind: "gone" });
    assert.deepEqual(pendingFileDeletions(db), [NEW]);
  });

  for (const killedAt of ["before the swap", "after the swap", "after the deletion"] as const)
    test(`killed ${killedAt}, the song ends with one Track and one file`, () => {
      const disk = new Set([OLD, NEW]);
      save([file(OLD)]);
      const id = idOf(OLD);
      setFavorites(db, [id], true, 1);
      const swap = () =>
        replaceTrackFile(db, creditSplits(), id, file(NEW, { bitrateKbps: 320 }), [], 2);
      /** What the app does after the swap, and at each launch: finishes the recorded deletions. */
      const finish = () => {
        const pending = pendingFileDeletions(db);
        for (const path of pending) disk.delete(path);
        forgetFileDeletions(db, pending);
      };
      if (killedAt !== "before the swap") swap();
      if (killedAt === "after the deletion") finish();
      // The next launch finishes what's recorded, and the journal replays the import.
      finish();
      swap();
      finish();
      assert.deepEqual(
        songs().map((song) => [song.id, song.path]),
        [[id, NEW]],
      );
      assert.deepEqual([...disk], [NEW]);
      assert.deepEqual(selectFavoriteTrackIds(db), [id]);
    });
});
