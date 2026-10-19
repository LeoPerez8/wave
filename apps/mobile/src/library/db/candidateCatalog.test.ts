/// <reference types="node" />
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import type { CatalogPageSong } from "@wave/core";

import { addCandidates, selectCandidateCatalog } from "./candidateCatalog.ts";
import { openTestDatabase, type TestDatabase } from "./testDatabase.ts";

const DAY = 24 * 60 * 60 * 1000;

let db: TestDatabase;

beforeEach(async () => {
  db = await openTestDatabase();
});

const song = (videoId: string, title = `Song ${videoId}`): CatalogPageSong => ({
  videoId,
  title,
  artists: ["Portishead"],
  album: "Dummy",
  albumId: "MPREb_dummy",
  durationMs: 240_000,
  artworkUrl: null,
  explicit: true,
});

/** [count] songs, `v<from>` on. */
const songs = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => song(`v${from + i}`));

const byId = () =>
  new Map(selectCandidateCatalog(db).map((entry) => [entry.song.videoId, entry] as const));

describe("The candidate catalog", () => {
  test("a radio's songs are kept with its seed and when they were seen", () => {
    addCandidates(
      db,
      { songs: [song("a", "Roads"), { ...song("v"), video: true }], seed: "Massive Attack" },
      10 * DAY,
    );
    assert.deepEqual(selectCandidateCatalog(db), [
      {
        song: song("a", "Roads"),
        firstSeenAt: 10 * DAY,
        lastSeenAt: 10 * DAY,
        radios: [{ seed: "massive attack", seedName: "Massive Attack", lastSeenAt: 10 * DAY }],
      },
    ]);
  });

  test("a song seen again is seen now and counts a new radio once", () => {
    addCandidates(db, { songs: [song("a")], seed: "Massive Attack" }, 10 * DAY);
    addCandidates(db, { songs: [song("a")], seed: "Massive Attack" }, 11 * DAY);
    addCandidates(db, { songs: [song("a", "Roads")], seed: "Tricky" }, 12 * DAY);
    addCandidates(db, { songs: [song("a", "Roads")], seed: null }, 13 * DAY);
    const entry = byId().get("a");
    assert.equal(entry?.song.title, "Roads");
    assert.equal(entry?.firstSeenAt, 10 * DAY);
    assert.equal(entry?.lastSeenAt, 13 * DAY);
    assert.deepEqual(
      entry?.radios.toSorted((x, y) => x.seed.localeCompare(y.seed)),
      [
        { seed: "massive attack", seedName: "Massive Attack", lastSeenAt: 11 * DAY },
        { seed: "tricky", seedName: "Tricky", lastSeenAt: 12 * DAY },
      ],
    );
  });

  test("a song unseen for 60 days leaves, and so does a radio that long gone", () => {
    addCandidates(db, { songs: [song("old"), song("kept")], seed: "Massive Attack" }, 0);
    addCandidates(db, { songs: [song("kept")], seed: "Tricky" }, 40 * DAY);
    addCandidates(db, { songs: [song("new")], seed: "Tricky" }, 61 * DAY);
    const catalog = byId();
    assert.deepEqual([...catalog.keys()].toSorted(), ["kept", "new"]);
    assert.deepEqual(
      catalog.get("kept")?.radios.map((radio) => radio.seed),
      ["tricky"],
    );
  });

  test("past 5,000 songs, the least recently seen leave", () => {
    addCandidates(db, { songs: songs(0, 3_000), seed: "Massive Attack" }, DAY);
    addCandidates(db, { songs: songs(3_000, 2_000), seed: "Tricky" }, 2 * DAY);
    addCandidates(db, { songs: songs(5_000, 2), seed: "Tricky" }, 3 * DAY);
    const catalog = byId();
    assert.equal(catalog.size, 5_000);
    assert.equal(catalog.has("v5001"), true);
    assert.equal(catalog.has("v3000"), true);
    assert.equal([...catalog.keys()].filter((id) => Number(id.slice(1)) < 3_000).length, 2_998);
  });
});
