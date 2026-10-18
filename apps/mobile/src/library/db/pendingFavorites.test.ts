/// <reference types="node" />
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import { normalizeTrack, type PendingFavorite } from "@wave/core";

import type { IndexedTrack } from "../LibraryStore.ts";
import { creditSplits } from "./credits.ts";
import {
  addPendingFavorites,
  removePendingFavorites,
  selectPendingFavorites,
} from "./pendingFavorites.ts";
import { selectFavoriteTrackIds, setFavorites } from "./playHistory.ts";
import { saveBatch } from "./save.ts";
import { migrateTestDatabase, openTestDatabase, type TestDatabase } from "./testDatabase.ts";

let db: TestDatabase;

beforeEach(async () => {
  db = await openTestDatabase();
});

const liked = (videoId: string, title: string, durationMs: number): PendingFavorite => ({
  videoId,
  title,
  artists: ["Daft Punk"],
  durationMs,
});

const file = (title: string, durationMs: number, videoId: string | null = null): IndexedTrack => ({
  ...normalizeTrack({
    path: `/Music/Daft Punk/${title}.m4a`,
    title,
    artist: "Daft Punk",
    album: "Random Access Memories",
    durationMs,
  }),
  sizeBytes: 1_000,
  modifiedAt: 0,
  sampleRate: null,
  bitrateKbps: null,
  artworkHash: null,
  hasLyrics: false,
  explicit: "unknown",
  videoId,
});

const save = (tracks: readonly IndexedTrack[], into: TestDatabase = db) =>
  saveBatch(into, creditSplits(), tracks, [], [], 1_000);

describe("pending favorites", () => {
  test("a download of a pending favorite's video stars it as it's saved", () => {
    addPendingFavorites(db, [liked("crush", "Instant Crush", 337_000)], 0);
    const { starred } = save([file("Instant Crush (feat. Julian Casablancas)", 338_500, "crush")]);
    assert.equal(starred.length, 1);
    assert.deepEqual(selectFavoriteTrackIds(db), starred);
  });

  test("a scan finding a file of its recording stars it, in a scan's batch too", () => {
    addPendingFavorites(db, [liked("crush", "Instant Crush", 337_000)], 0);
    const { starred } = saveBatch(db, creditSplits(), [file("Instant Crush", 337_000)], [], [], 0, {
      linkEntries: false,
    });
    assert.deepEqual(selectFavoriteTrackIds(db), starred);
    assert.equal(starred.length, 1);
  });

  test("a song that isn't one stars nothing, and the pending favorite waits", () => {
    addPendingFavorites(db, [liked("crush", "Instant Crush", 337_000)], 0);
    assert.deepEqual(save([file("Touch", 498_000)]).starred, []);
    assert.deepEqual(selectFavoriteTrackIds(db), []);
    assert.equal(save([file("Instant Crush", 337_000)]).starred.length, 1);
  });

  test("once starred it's settled: a star taken off by hand stays off when the file is saved again", () => {
    addPendingFavorites(db, [liked("crush", "Instant Crush", 337_000)], 0);
    const { starred } = save([file("Instant Crush", 337_000, "crush")]);
    setFavorites(db, starred, false, 2_000);
    assert.deepEqual(save([file("Instant Crush", 337_000, "crush")]).starred, []);
    assert.deepEqual(selectFavoriteTrackIds(db), []);
  });

  test("importing the liked song again keeps one pending favorite, which still settles", () => {
    addPendingFavorites(db, [liked("crush", "Instant Crush", 337_000)], 0);
    addPendingFavorites(db, [liked("crush", "Instant Crush", 337_000)], 500);
    assert.equal(save([file("Instant Crush", 337_000)]).starred.length, 1);
  });

  test("a pending favorite unstarred before its file arrives stars nothing when it does", () => {
    addPendingFavorites(
      db,
      [liked("crush", "Instant Crush", 337_000), liked("touch", "Touch", 498_000)],
      0,
    );
    removePendingFavorites(db, ["crush"]);
    assert.deepEqual(
      selectPendingFavorites(db).map((favorite) => favorite.videoId),
      ["touch"],
    );
    assert.deepEqual(save([file("Instant Crush", 337_000, "crush")]).starred, []);
    assert.deepEqual(selectFavoriteTrackIds(db), []);
  });

  test("a database from before pending favorites records them once upgraded", async () => {
    const old = await openTestDatabase({ through: "0026_explicit" });
    await migrateTestDatabase(old);
    addPendingFavorites(old, [liked("crush", "Instant Crush", 337_000)], 0);
    const { starred } = save([file("Instant Crush", 337_000, "crush")], old);
    assert.equal(starred.length, 1);
    assert.deepEqual(selectFavoriteTrackIds(old), starred);
  });

  test("a database from before explicit flags upgrades through both migrations in order", async () => {
    const old = await openTestDatabase({ through: "0025_unsearched_titles" });
    await migrateTestDatabase(old);
    addPendingFavorites(old, [liked("crush", "Instant Crush", 337_000)], 0);
    const { starred } = save(
      [{ ...file("Instant Crush", 337_000, "crush"), explicit: "clean" }],
      old,
    );
    assert.equal(starred.length, 1);
    assert.deepEqual(selectFavoriteTrackIds(old), starred);
  });
});
