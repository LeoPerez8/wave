import assert from "node:assert/strict";
import { test } from "node:test";

import { djMoodFeaturesSteps, finishSteps, type CatalogPageSong } from "@wave/core";
import { eq } from "drizzle-orm";

import { addCandidates } from "./candidateCatalog.ts";
import {
  DJ_MOOD_MAX_FAILURES,
  DJ_MOOD_MISS_TTL_MS,
  DJ_MOOD_RETRY_MS,
  djMoodFeatureRows,
  keepDjMoodFeatures,
  pendingDjMoodSongs,
  selectDjMoodFeatures,
} from "./djMoodFeatures.ts";
import { readConnections, replayRead } from "./offThreadReads.ts";
import { candidateSongs } from "./schema.ts";
import { asyncReadClient, openTestDatabase } from "./testDatabase.ts";

const song = (videoId: string): CatalogPageSong => ({
  videoId,
  title: `Song ${videoId}`,
  artists: ["Artist"],
  album: null,
  albumId: null,
  durationMs: 200_000,
  artworkUrl: null,
  explicit: false,
});

test("candidate mood misses expire after 30 days while matches stay cached by video id", async () => {
  const db = await openTestDatabase();
  addCandidates(db, { songs: [song("a"), song("b")], seed: "Artist" }, 10);
  assert.deepEqual(
    pendingDjMoodSongs(db, "", 20).songs.map((entry) => entry.videoId),
    ["a", "b"],
  );
  keepDjMoodFeatures(db, [
    { videoId: "a", isrc: "USABC0000001", features: null, checkedAt: 20 },
    {
      videoId: "b",
      isrc: "USABC0000002",
      features: { energy: 0.9, valence: 0.8, acousticness: 0.1, mode: 1 },
      checkedAt: 20,
    },
  ]);
  assert.deepEqual(pendingDjMoodSongs(db, "", 20).songs, []);
  assert.deepEqual(pendingDjMoodSongs(db, "", 20 + DJ_MOOD_MISS_TTL_MS).songs, [
    { videoId: "a", title: "Song a", artists: ["Artist"], durationMs: 200_000 },
  ]);
  assert.deepEqual(selectDjMoodFeatures(db, ["a", "b"]).get("b"), {
    energy: 0.9,
    valence: 0.8,
    acousticness: 0.1,
    mode: 1,
  });
});

test("a lookup that failed waits to be retried instead of coming due on the next pass (#1437)", async () => {
  const db = await openTestDatabase();
  addCandidates(db, { songs: [song("a"), song("b")], seed: "Artist" }, 10);
  keepDjMoodFeatures(db, [
    { videoId: "a", isrc: null, features: null, checkedAt: 20, failed: true },
  ]);
  const due = (now: number) => pendingDjMoodSongs(db, "", now).songs.map((entry) => entry.videoId);
  assert.deepEqual(due(20), ["b"]);
  assert.deepEqual(due(20 + DJ_MOOD_RETRY_MS - 1), ["b"]);
  assert.deepEqual(due(20 + DJ_MOOD_RETRY_MS), ["a", "b"]);
  assert.ok(DJ_MOOD_RETRY_MS < DJ_MOOD_MISS_TTL_MS);
  // A failed retry leaves a feature match alone, like any miss.
  keepDjMoodFeatures(db, [
    {
      videoId: "b",
      isrc: "USABC0000002",
      features: { energy: 0.9, valence: 0.8, acousticness: 0.1, mode: 1 },
      checkedAt: 30,
    },
  ]);
  keepDjMoodFeatures(db, [
    { videoId: "b", isrc: null, features: null, checkedAt: 40, failed: true },
  ]);
  assert.equal(selectDjMoodFeatures(db, ["b"]).get("b")?.energy, 0.9);
});

test("a song whose lookup keeps failing is tried a bounded number of times, then left as a miss (#1449)", async () => {
  const db = await openTestDatabase();
  addCandidates(db, { songs: [song("a")], seed: "Artist" }, 0);
  const HOUR = 60 * 60 * 1000;
  // The worker asks about every due song, and every lookup of "a" fails, for 29 days.
  let tries = 0;
  let lastTry = 0;
  for (let now = 10; now < 29 * 24 * HOUR; now += HOUR) {
    if (pendingDjMoodSongs(db, "", now).songs.length === 0) continue;
    tries++;
    lastTry = now;
    keepDjMoodFeatures(db, [
      { videoId: "a", isrc: null, features: null, checkedAt: now, failed: true },
    ]);
  }
  assert.equal(tries, DJ_MOOD_MAX_FAILURES);
  // Left, it comes due only when every miss does.
  assert.deepEqual(pendingDjMoodSongs(db, "", lastTry + DJ_MOOD_MISS_TTL_MS - 1).songs, []);
  assert.equal(pendingDjMoodSongs(db, "", lastTry + DJ_MOOD_MISS_TTL_MS).songs.length, 1);
});

test("a lookup that answers starts a failed song's count again", async () => {
  const db = await openTestDatabase();
  addCandidates(db, { songs: [song("a")], seed: "Artist" }, 0);
  const fail = (at: number) =>
    keepDjMoodFeatures(db, [
      { videoId: "a", isrc: null, features: null, checkedAt: at, failed: true },
    ]);
  for (let k = 1; k < DJ_MOOD_MAX_FAILURES; k++) fail(k * DJ_MOOD_RETRY_MS);
  // A month later the miss expires, the lookup answers with no match, then fails again.
  const answered = DJ_MOOD_MAX_FAILURES * DJ_MOOD_RETRY_MS;
  keepDjMoodFeatures(db, [{ videoId: "a", isrc: null, features: null, checkedAt: answered }]);
  const later = answered + DJ_MOOD_MISS_TTL_MS;
  fail(later);
  // One failure since the answer: it waits for the retry, not for the miss TTL.
  assert.equal(pendingDjMoodSongs(db, "", later + DJ_MOOD_RETRY_MS).songs.length, 1);
});

test("a later miss cannot replace a feature match", async () => {
  const db = await openTestDatabase();
  addCandidates(db, { songs: [song("a")], seed: null }, 10);
  keepDjMoodFeatures(db, [
    {
      videoId: "a",
      isrc: "USABC0000001",
      features: { energy: 0.7, valence: 0.6, acousticness: 0.2, mode: 0 },
      checkedAt: 20,
    },
  ]);
  keepDjMoodFeatures(db, [{ videoId: "a", isrc: null, features: null, checkedAt: 30 }]);
  assert.equal(selectDjMoodFeatures(db, ["a"]).get("a")?.energy, 0.7);
});

test("feature rows leave with candidate songs when the catalog prunes them", async () => {
  const db = await openTestDatabase();
  addCandidates(db, { songs: [song("old")], seed: "Artist" }, 0);
  keepDjMoodFeatures(db, [
    {
      videoId: "old",
      isrc: "USABC0000001",
      features: { energy: 0.7, valence: 0.6, acousticness: 0.2, mode: 0 },
      checkedAt: 1,
    },
  ]);
  addCandidates(db, { songs: [song("new")], seed: "Artist" }, 61 * 24 * 60 * 60 * 1000);
  assert.deepEqual(selectDjMoodFeatures(db, ["old"]), new Map());
});

test("a song the catalog pruned before the write is skipped and the rest are kept", async () => {
  const db = await openTestDatabase();
  addCandidates(db, { songs: [song("kept")], seed: "Artist" }, 10);
  keepDjMoodFeatures(db, [
    { videoId: "pruned", isrc: null, features: null, checkedAt: 20 },
    {
      videoId: "kept",
      isrc: "USABC0000001",
      features: { energy: 0.7, valence: 0.6, acousticness: 0.2, mode: 0 },
      checkedAt: 20,
    },
  ]);
  assert.equal(selectDjMoodFeatures(db, ["kept"]).get("kept")?.energy, 0.7);
  assert.deepEqual(selectDjMoodFeatures(db, ["pruned"]), new Map());
});

test("a stored song that cannot be read is reported with the page cursor so it can be saved as a miss", async () => {
  const db = await openTestDatabase();
  addCandidates(db, { songs: [song("a"), song("b"), song("c")], seed: "Artist" }, 10);
  db.update(candidateSongs).set({ song: "{" }).where(eq(candidateSongs.videoId, "b")).run();
  const page = pendingDjMoodSongs(db, "a", 20, 1);
  assert.deepEqual(page, { songs: [], unreadable: ["b"], last: "b" });
  assert.deepEqual(
    pendingDjMoodSongs(db, page.last ?? "", 20).songs.map((entry) => entry.videoId),
    ["c"],
  );
  keepDjMoodFeatures(db, [{ videoId: "b", isrc: null, features: null, checkedAt: 20 }]);
  assert.deepEqual(pendingDjMoodSongs(db, "", 20).unreadable, []);
});

test("3,700 videos' features read in one statement, off the thread as on it (#1532)", async () => {
  const db = await openTestDatabase();
  const ids = Array.from({ length: 3_700 }, (_, at) => `v${String(at).padStart(5, "0")}`);
  addCandidates(db, { songs: ids.map(song), seed: "Artist" }, 10);
  keepDjMoodFeatures(
    db,
    ids.map((videoId, at) => ({
      videoId,
      isrc: null,
      features:
        at % 5 === 0
          ? null
          : { energy: (at % 100) / 100, valence: 0.5, acousticness: 0.3, mode: 1 },
      checkedAt: 20,
    })),
  );
  const asked = [...ids, "not kept"];
  const reads = readConnections(async () => asyncReadClient(db));
  const replayed = await replayRead(
    reads,
    (d) => djMoodFeatureRows(d, asked),
    () => 0,
  );
  assert.equal(replayed.statements, 1);
  const features = finishSteps(djMoodFeaturesSteps(replayed.value));
  assert.deepEqual(features, selectDjMoodFeatures(db, asked));
  assert.equal(features.size, 2_960);
  assert.deepEqual(features.get("v00001"), {
    energy: 0.01,
    valence: 0.5,
    acousticness: 0.3,
    mode: 1,
  });
  assert.equal(features.has("v00000"), false);
});
