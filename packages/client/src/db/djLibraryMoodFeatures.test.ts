/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";

import { djMoodFeaturesSteps, finishSteps, normalizeTrack } from "@wave/core";
import { eq } from "drizzle-orm";

import type { IndexedTrack } from "../types.ts";
import { addCandidates } from "./candidateCatalog.ts";
import { creditSplits } from "./credits.ts";
import {
  DJ_LIBRARY_MOOD_MISS_TTL_MS,
  djLibraryMoodFeatureRows,
  keepDjLibraryMoodFeatures,
  pendingDjLibraryMoodSongs,
  selectDjLibraryMoodFeatures,
} from "./djLibraryMoodFeatures.ts";
import { keepDjMoodFeatures } from "./djMoodFeatures.ts";
import { readConnections, replayRead } from "./offThreadReads.ts";
import { saveBatch } from "./save.ts";
import { tracks } from "./schema.ts";
import { asyncReadClient, openTestDatabase } from "./testDatabase.ts";
import { trackQuery } from "./tracks.ts";

type Db = Awaited<ReturnType<typeof openTestDatabase>>;

/** A file as the scanner reads it, with the ISRC tag [isrc]. */
const scanned = (title: string, isrc: string | null): IndexedTrack => ({
  ...normalizeTrack({ path: `/Music/${title}.mp3`, title, artist: "Artist", durationMs: 1 }),
  sizeBytes: 1_000,
  modifiedAt: 1,
  sampleRate: null,
  bitrateKbps: null,
  artworkHash: null,
  hasLyrics: false,
  explicit: "unknown",
  isrc,
});

const save = (db: Db, tracks: readonly IndexedTrack[]) =>
  saveBatch(db, creditSplits(), tracks, [], [], 1_000);

const idOf = (db: Db, title: string): number => {
  const row = trackQuery(db)
    .all()
    .find((song) => song.title === title);
  assert.ok(row, title);
  return row.id;
};

const loud = { energy: 0.9, valence: 0.8, acousticness: 0.1, mode: 1 as const };

test("Library songs with an ISRC tag are due for a mood lookup; songs without one never are", async () => {
  const db = await openTestDatabase();
  save(db, [scanned("Tagged", "USRC17607839"), scanned("Untagged", null)]);
  assert.deepEqual(pendingDjLibraryMoodSongs(db, 0, 10), [
    { trackId: idOf(db, "Tagged"), isrc: "USRC17607839" },
  ]);
});

test("a match is kept against the Library track for good, a miss for 30 days", async () => {
  const db = await openTestDatabase();
  save(db, [scanned("Found", "USRC17607839"), scanned("Missed", "GBAYE0601498")]);
  const found = idOf(db, "Found");
  const missed = idOf(db, "Missed");
  keepDjLibraryMoodFeatures(db, [
    { trackId: found, isrc: "USRC17607839", features: loud, checkedAt: 10 },
    { trackId: missed, isrc: "GBAYE0601498", features: null, checkedAt: 10 },
  ]);
  assert.deepEqual(selectDjLibraryMoodFeatures(db), new Map([[String(found), loud]]));
  assert.deepEqual(pendingDjLibraryMoodSongs(db, 0, 11), []);
  assert.deepEqual(
    pendingDjLibraryMoodSongs(db, 0, 10 + DJ_LIBRARY_MOOD_MISS_TTL_MS).map((s) => s.trackId),
    [missed],
  );
  keepDjLibraryMoodFeatures(db, [
    { trackId: found, isrc: "USRC17607839", features: null, checkedAt: 20 },
  ]);
  assert.equal(selectDjLibraryMoodFeatures(db).get(String(found))?.energy, 0.9);
});

test("a file whose ISRC tag changes is looked up again and its old features stop counting", async () => {
  const db = await openTestDatabase();
  save(db, [scanned("Song", "USRC17607839")]);
  const id = idOf(db, "Song");
  keepDjLibraryMoodFeatures(db, [
    { trackId: id, isrc: "USRC17607839", features: loud, checkedAt: 10 },
  ]);
  save(db, [{ ...scanned("Song", "GBAYE0601498"), modifiedAt: 2 }]);
  assert.deepEqual(selectDjLibraryMoodFeatures(db), new Map());
  assert.deepEqual(pendingDjLibraryMoodSongs(db, 0, 11), [{ trackId: id, isrc: "GBAYE0601498" }]);
  keepDjLibraryMoodFeatures(db, [
    { trackId: id, isrc: "GBAYE0601498", features: { ...loud, energy: 0.2 }, checkedAt: 12 },
  ]);
  assert.equal(selectDjLibraryMoodFeatures(db).get(String(id))?.energy, 0.2);
});

test("pages follow track ids after the last one", async () => {
  const db = await openTestDatabase();
  save(db, [scanned("A", "USRC17607831"), scanned("B", "USRC17607832")]);
  const [first, second] = pendingDjLibraryMoodSongs(db, 0, 10, 1).concat(
    pendingDjLibraryMoodSongs(db, idOf(db, "A"), 10, 1),
  );
  assert.equal(first?.trackId, idOf(db, "A"));
  assert.equal(second?.trackId, idOf(db, "B"));
});

test("a song downloaded from a video goes by that video's stream features before its ISRC tag's", async () => {
  const db = await openTestDatabase();
  save(db, [scanned("Downloaded", "USRC17607839"), scanned("Streamless", null)]);
  const downloaded = idOf(db, "Downloaded");
  db.update(tracks).set({ videoId: "v1" }).where(eq(tracks.id, downloaded)).run();
  keepDjLibraryMoodFeatures(db, [
    { trackId: downloaded, isrc: "USRC17607839", features: loud, checkedAt: 10 },
  ]);
  const calm = { energy: 0.2, valence: 0.6, acousticness: 0.8, mode: 1 as const };
  addCandidates(
    db,
    {
      songs: [
        {
          videoId: "v1",
          title: "Downloaded",
          artists: ["Artist"],
          album: null,
          albumId: null,
          durationMs: 1,
          artworkUrl: null,
          explicit: false,
        },
      ],
      seed: "Artist",
    },
    10,
  );
  keepDjMoodFeatures(db, [{ videoId: "v1", isrc: null, features: calm, checkedAt: 10 }]);
  assert.deepEqual(selectDjLibraryMoodFeatures(db), new Map([[String(downloaded), calm]]));
});

test("the Library's features read in one statement, off the thread as on it (#1532)", async () => {
  const db = await openTestDatabase();
  save(db, [scanned("Downloaded", "USRC17607839"), scanned("Tagged", "GBAYE0601498")]);
  const downloaded = idOf(db, "Downloaded");
  const tagged = idOf(db, "Tagged");
  db.update(tracks).set({ videoId: "v1" }).where(eq(tracks.id, downloaded)).run();
  const calm = { energy: 0.2, valence: 0.6, acousticness: 0.8, mode: 1 as const };
  keepDjLibraryMoodFeatures(db, [
    { trackId: downloaded, isrc: "USRC17607839", features: loud, checkedAt: 10 },
    { trackId: tagged, isrc: "GBAYE0601498", features: loud, checkedAt: 10 },
  ]);
  addCandidates(db, { songs: [{ videoId: "v1", title: "Downloaded", artists: ["Artist"], album: null, albumId: null, durationMs: 1, artworkUrl: null, explicit: false }], seed: "Artist" }, 10);
  keepDjMoodFeatures(db, [{ videoId: "v1", isrc: null, features: calm, checkedAt: 10 }]);
  const reads = readConnections(async () => asyncReadClient(db));
  const replayed = await replayRead(reads, djLibraryMoodFeatureRows, () => 0);
  assert.equal(replayed.statements, 1);
  assert.deepEqual(
    finishSteps(djMoodFeaturesSteps(replayed.value)),
    new Map([
      [String(downloaded), calm],
      [String(tagged), loud],
    ]),
  );
  assert.deepEqual(finishSteps(djMoodFeaturesSteps(replayed.value)), selectDjLibraryMoodFeatures(db));
});
