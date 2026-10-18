/// <reference types="node" />
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import { normalizeTrack } from "@wave/core";
import { eq } from "drizzle-orm";

import type { IndexedTrack } from "../LibraryStore.ts";
import { creditSplits } from "./credits.ts";
import { pendingFileDeletions } from "./fileDeletions.ts";
import { recordPlay, selectFavoriteTrackIds, setFavorites } from "./playHistory.ts";
import { createPlaylist } from "./playlists.ts";
import { fixReplacementDuplicate, selectDuplicateCheckFiles } from "./replacementDuplicates.ts";
import { saveBatch } from "./save.ts";
import * as schema from "./schema.ts";
import { openTestDatabase, type TestDatabase } from "./testDatabase.ts";

let db: TestDatabase;

beforeEach(async () => {
  db = await openTestDatabase();
});

const MP3 = "/Music/Arctic Monkeys/AM/Arctic Monkeys - 505.mp3";
const M4A = "/Music/Arctic Monkeys/AM/Arctic Monkeys - 505.m4a";

const file = (path: string, patch: Partial<IndexedTrack> = {}): IndexedTrack => ({
  ...normalizeTrack({
    path,
    title: "505",
    artist: "Arctic Monkeys",
    album: "Favourite Worst Nightmare",
    durationMs: 253_000,
  }),
  sizeBytes: 10_120_000,
  modifiedAt: 0,
  sampleRate: 44_100,
  bitrateKbps: 320,
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
      fileName: schema.tracks.fileName,
    })
    .from(schema.tracks)
    .all();

/** The Oct-18 leftover: the MP3 with its history, and the M4A copy freeing space as a bare second song. */
const leftTwice = () => {
  save([file(MP3), file(M4A, { bitrateKbps: 128, sizeBytes: 4_050_000, hasLyrics: false })]);
  const mp3 = idOf(MP3);
  setFavorites(db, [mp3], true, 1);
  const indie = createPlaylist(db, "Indie", [{ source: "library", trackId: mp3 }], 1).playlistId;
  play(mp3, 5);
  return { mp3, m4a: idOf(M4A), indie };
};

const play = (trackId: number, startedAt: number) =>
  recordPlay(db, {
    trackId: String(trackId),
    startedAt,
    listenedMs: 253_000,
    durationMs: 253_000,
    endReason: "completed",
    counted: true,
    context: null,
    source: "phone",
  });

/** What the check read of Track [id]: its file, star and playlists (`selectDuplicateCheckFiles`). */
const checked = (id: number) => {
  const found = selectDuplicateCheckFiles(db).find((song) => song.id === id)!;
  return { id, path: found.path, favorite: found.favorite, playlists: found.playlists };
};

const liveEntries = () =>
  db
    .select({ playlistId: schema.playlistItems.playlistId, trackId: schema.playlistItems.trackId })
    .from(schema.playlistItems)
    .where(eq(schema.playlistItems.deleted, false))
    .orderBy(schema.playlistItems.playlistId)
    .all();

describe("the files the duplicate check looks at", () => {
  test("MP3 and M4A files, with their recordings and their Track's star, plays and playlists", () => {
    const { mp3, m4a, indie } = leftTwice();
    play(mp3, 6);
    const rock = createPlaylist(db, "Rock", [{ source: "library", trackId: mp3 }], 1).playlistId;
    save([file("/Music/b.flac", { title: "Lossless" })]);
    assert.deepEqual(
      selectDuplicateCheckFiles(db).map((song) => [
        song.id,
        song.path,
        song.title,
        song.artists,
        song.durationMs,
        song.favorite,
        song.plays,
        song.playlists,
        song.recordingKey !== null,
      ]),
      [
        [mp3, MP3, "505", ["Arctic Monkeys"], 253_000, true, 2, [indie, rock], true],
        [m4a, M4A, "505", ["Arctic Monkeys"], 253_000, false, 0, [], true],
      ],
    );
  });
});

describe("putting a song left twice back to one", () => {
  test("the Track with the history takes the M4A; the bare one goes and the MP3 is recorded to go", () => {
    const { mp3, m4a } = leftTwice();
    assert.equal(
      fixReplacementDuplicate(
        db,
        creditSplits(),
        { keep: checked(mp3), drop: checked(m4a), path: M4A, deleted: MP3, merge: null },
        2,
      ),
      true,
    );
    assert.deepEqual(songs(), [
      { id: mp3, path: M4A, bitrateKbps: 128, fileName: "Arctic Monkeys - 505.m4a" },
    ]);
    assert.deepEqual(selectFavoriteTrackIds(db), [mp3]);
    assert.deepEqual(
      db.select({ trackId: schema.playlistItems.trackId }).from(schema.playlistItems).all(),
      [{ trackId: mp3 }],
    );
    assert.deepEqual(
      db.select({ trackId: schema.playEvents.trackId }).from(schema.playEvents).all(),
      [{ trackId: mp3 }],
    );
    assert.deepEqual(pendingFileDeletions(db), [MP3]);
  });

  test("kept on the old file, only the bare Track goes and the new file is recorded to go", () => {
    const { mp3, m4a } = leftTwice();
    fixReplacementDuplicate(
      db,
      creditSplits(),
      { keep: checked(mp3), drop: checked(m4a), path: MP3, deleted: M4A, merge: null },
      2,
    );
    assert.deepEqual(songs(), [
      { id: mp3, path: MP3, bitrateKbps: 320, fileName: "Arctic Monkeys - 505.mp3" },
    ]);
    assert.deepEqual(pendingFileDeletions(db), [M4A]);
  });

  test("a Library changed since the check read it is left as it is", () => {
    const { mp3, m4a } = leftTwice();
    const [keep, drop] = [checked(mp3), checked(m4a)];
    // A scan moved the bare song meanwhile.
    db.update(schema.tracks)
      .set({ path: "/Music/moved.m4a" })
      .where(eq(schema.tracks.id, m4a))
      .run();
    assert.equal(
      fixReplacementDuplicate(
        db,
        creditSplits(),
        { keep, drop, path: M4A, deleted: MP3, merge: null },
        2,
      ),
      false,
    );
    assert.equal(songs().length, 2);
    assert.deepEqual(pendingFileDeletions(db), []);
  });

  test("both Tracks with history merge: either's star, all plays, entries named once", () => {
    const { mp3, m4a, indie } = leftTwice();
    // The bare song picked up a play, and entries in Indie (already holding the MP3) and Gym.
    play(m4a, 9);
    db.insert(schema.playlistItems)
      .values({ playlistId: indie, trackId: m4a, orderKey: "z", addedAt: 3, changedAt: 3 })
      .run();
    const gym = createPlaylist(db, "Gym", [{ source: "library", trackId: m4a }], 3).playlistId;
    setFavorites(db, [mp3], false, 4);
    setFavorites(db, [m4a], true, 4);
    const merge = { star: true, movePlays: true, repoint: [gym], remove: [indie] };
    assert.equal(
      fixReplacementDuplicate(
        db,
        creditSplits(),
        { keep: checked(mp3), drop: checked(m4a), path: M4A, deleted: MP3, merge },
        5,
      ),
      true,
    );
    assert.deepEqual(
      songs().map((song) => [song.id, song.path]),
      [[mp3, M4A]],
    );
    assert.deepEqual(selectFavoriteTrackIds(db), [mp3]);
    assert.deepEqual(
      db.select({ trackId: schema.playEvents.trackId }).from(schema.playEvents).all(),
      [{ trackId: mp3 }, { trackId: mp3 }],
    );
    assert.deepEqual(liveEntries(), [
      { playlistId: indie, trackId: mp3 },
      { playlistId: gym, trackId: mp3 },
    ]);
  });

  test("history that changed since the check read it leaves the pair as it is", () => {
    const { mp3, m4a } = leftTwice();
    const [keep, drop] = [checked(mp3), checked(m4a)];
    createPlaylist(db, "Gym", [{ source: "library", trackId: m4a }], 3);
    assert.equal(
      fixReplacementDuplicate(
        db,
        creditSplits(),
        { keep, drop, path: M4A, deleted: MP3, merge: null },
        5,
      ),
      false,
    );
    assert.equal(songs().length, 2);
  });
});
