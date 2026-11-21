import assert from "node:assert/strict";
import { test } from "node:test";

import type { CatalogPageSong } from "@wave/core";
import { eq } from "drizzle-orm";

import { addCandidates } from "./candidateCatalog.ts";
import {
  DJ_MOOD_MISS_TTL_MS,
  keepDjMoodFeatures,
  pendingDjMoodSongs,
  selectDjMoodFeatures,
} from "./djMoodFeatures.ts";
import { candidateSongs } from "./schema.ts";
import { openTestDatabase } from "./testDatabase.ts";

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
