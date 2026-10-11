/// <reference types="node" />
import type { PlayEvent } from "@wave/core";
import { eq } from "drizzle-orm";
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import { homeSections, latestPlay, recordPlay, updatePlay } from "./playHistory.ts";
import * as schema from "./schema.ts";
import { addTrack, openTestDatabase, star, type TestDatabase } from "./testDatabase.ts";

const album = { kind: "album", id: "1" } as const;

/** A play of `trackId` that started at `startedAt`. */
const play = (
  trackId: number,
  startedAt: number,
  overrides: Partial<PlayEvent> = {},
): PlayEvent => ({
  trackId: String(trackId),
  context: album,
  startedAt,
  listenedMs: 180_000,
  durationMs: 180_000,
  endReason: "completed",
  counted: true,
  ...overrides,
});

let db: TestDatabase;

beforeEach(async () => {
  db = await openTestDatabase();
});

describe("Recently Added", () => {
  test("lists albums by when their newest song entered the library, newest first", () => {
    addTrack(db, { title: "Old 1", album: "Old", addedAt: 1_000 });
    addTrack(db, { title: "Newer", album: "Newer", addedAt: 2_000 });
    // A song added later to an older album brings the album forward.
    addTrack(db, { title: "Old 2", album: "Old", addedAt: 3_000 });

    const added = homeSections(db).recentlyAdded;
    assert.deepEqual(
      added.map((row) => [row.title, row.trackCount]),
      [
        ["Old", 2],
        ["Newer", 1],
      ],
    );
  });
});

describe("History of removed files", () => {
  test("a played track can leave the library, and Home stops listing it", () => {
    const gone = addTrack(db, { title: "Deleted", album: "Gone" });
    const kept = addTrack(db, { title: "Kept", album: "Here" });
    recordPlay(db, play(gone, 1_000));
    recordPlay(db, play(kept, 2_000));

    db.delete(schema.tracks).where(eq(schema.tracks.id, gone)).run();

    const home = homeSections(db);
    assert.deepEqual(
      home.recentlyPlayed.map((row) => row.title),
      ["Here"],
    );
    assert.deepEqual(
      home.mostPlayed.map((row) => row.title),
      ["Kept"],
    );
  });
});

describe("Favorites", () => {
  test("lists starred songs, the most recently starred first", () => {
    const early = addTrack(db, { title: "Starred early" });
    const late = addTrack(db, { title: "Starred late" });
    addTrack(db, { title: "Not starred" });
    star(db, early, 1_000);
    star(db, late, 2_000);

    assert.deepEqual(
      homeSections(db).favorites.map((row) => row.title),
      ["Starred late", "Starred early"],
    );
  });
});

describe("Recently Played", () => {
  test("lists the albums of the tracks played, the latest first", () => {
    const blue = addTrack(db, { title: "Blue in Green", album: "Kind of Blue" });
    const so = addTrack(db, { title: "So What", album: "Kind of Blue" });
    const koln = addTrack(db, { title: "Part I", album: "The Köln Concert" });
    addTrack(db, { title: "Never played", album: "Silent" });

    recordPlay(db, play(blue, 1_000));
    recordPlay(db, play(koln, 2_000));
    recordPlay(db, play(so, 3_000));

    assert.deepEqual(
      homeSections(db).recentlyPlayed.map((row) => row.title),
      ["Kind of Blue", "The Köln Concert"],
    );
  });
});

describe("Most Played", () => {
  test("ranks tracks by counted plays only; skips and short plays don't count", () => {
    const often = addTrack(db, { title: "Often" });
    const skipped = addTrack(db, { title: "Skipped a lot" });
    const never = addTrack(db, { title: "Only sampled" });
    const skip = { endReason: "skipped", listenedMs: 10_000, counted: false } as const;

    let at = 0;
    for (let i = 0; i < 3; i += 1) recordPlay(db, play(often, (at += 1)));
    for (let i = 0; i < 2; i += 1) recordPlay(db, play(skipped, (at += 1)));
    for (let i = 0; i < 5; i += 1) recordPlay(db, play(skipped, (at += 1), skip));
    recordPlay(db, play(never, (at += 1), skip));

    assert.deepEqual(
      homeSections(db).mostPlayed.map((row) => [row.title, row.playCount]),
      [
        ["Often", 3],
        ["Skipped a lot", 2],
      ],
    );
  });

  test("a play recorded as it starts counts once it has been listened to enough", () => {
    const track = addTrack(db, { title: "Growing" });
    const id = recordPlay(
      db,
      play(track, 1_000, { listenedMs: 0, endReason: "interrupted", counted: false }),
    );
    assert.deepEqual(homeSections(db).mostPlayed, []);

    updatePlay(db, id, play(track, 1_000, { listenedMs: 95_000, endReason: "completed" }));
    updatePlay(db, id, play(track, 1_000, { listenedMs: 180_000, endReason: "completed" }));
    assert.deepEqual(
      homeSections(db).mostPlayed.map((row) => [row.title, row.playCount]),
      [["Growing", 1]],
    );
  });

  test("breaks ties by the most recent counted play", () => {
    const first = addTrack(db, { title: "First" });
    const second = addTrack(db, { title: "Second" });
    recordPlay(db, play(first, 1_000));
    recordPlay(db, play(second, 2_000));

    assert.deepEqual(
      homeSections(db).mostPlayed.map((row) => row.title),
      ["Second", "First"],
    );
  });
});

describe("The latest play", () => {
  test("is the play recorded last, as last brought up to date, to pick it back up", () => {
    const first = addTrack(db, { title: "First" });
    const second = addTrack(db, { title: "Second" });
    recordPlay(db, play(first, 1_000));
    const going = { listenedMs: 0, endReason: "interrupted", counted: false } as const;
    const id = recordPlay(db, play(second, 200_000, going));
    updatePlay(db, id, play(second, 200_000, { ...going, listenedMs: 45_000 }));

    assert.deepEqual(latestPlay(db), {
      id,
      play: play(second, 200_000, { ...going, listenedMs: 45_000 }),
    });
  });

  test("a play outside any context comes back without one", () => {
    const track = addTrack(db, { title: "Queued" });
    const id = recordPlay(db, play(track, 1_000, { context: null }));
    assert.deepEqual(latestPlay(db), { id, play: play(track, 1_000, { context: null }) });
  });

  test("there is none before anything was played", () => {
    assert.equal(latestPlay(db), null);
  });
});
