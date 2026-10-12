/// <reference types="node" />
import type { PlayEvent } from "@wave/core";
import { eq } from "drizzle-orm";
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import { recordPlay } from "./playHistory.ts";
import * as schema from "./schema.ts";
import { trackPlayTotals } from "./stats.ts";
import { addTrack, openTestDatabase, type TestDatabase } from "./testDatabase.ts";

/** A counted play of `trackId` that started at `startedAt`. */
const play = (
  trackId: number,
  startedAt: number,
  overrides: Partial<PlayEvent> = {},
): PlayEvent => ({
  trackId: String(trackId),
  context: null,
  startedAt,
  listenedMs: 180_000,
  durationMs: 180_000,
  endReason: "completed",
  counted: true,
  ...overrides,
});

const skip = { endReason: "skipped", listenedMs: 10_000, counted: false } as const;

let db: TestDatabase;

beforeEach(async () => {
  db = await openTestDatabase();
});

const byId = (rows: ReturnType<typeof trackPlayTotals>) =>
  [...rows].sort((a, b) => a.id - b.id);

describe("Per-track play totals", () => {
  test("sum each track's counted plays, listened time and latest counted play", () => {
    const blue = addTrack(db, { title: "Blue in Green" });
    const so = addTrack(db, { title: "So What" });
    addTrack(db, { title: "Never played" });
    recordPlay(db, play(blue, 1_000, { listenedMs: 100_000 }));
    recordPlay(db, play(blue, 3_000, { listenedMs: 200_000 }));
    recordPlay(db, play(so, 2_000, { listenedMs: 150_000 }));

    assert.deepEqual(byId(trackPlayTotals(db, { from: null, to: 10_000 })), [
      {
        id: blue,
        sortKey: "blue in green",
        countedPlays: 2,
        listenedMs: 300_000,
        latestPlayAt: 3_000,
      },
      { id: so, sortKey: "so what", countedPlays: 1, listenedMs: 150_000, latestPlayAt: 2_000 },
    ]);
  });

  test("only counted plays count: skips add neither plays, time nor recency", () => {
    const track = addTrack(db, { title: "Sampled" });
    const never = addTrack(db, { title: "Only skipped" });
    recordPlay(db, play(track, 1_000));
    recordPlay(db, play(track, 5_000, skip));
    recordPlay(db, play(never, 2_000, skip));

    assert.deepEqual(trackPlayTotals(db, { from: null, to: 10_000 }), [
      { id: track, sortKey: "sampled", countedPlays: 1, listenedMs: 180_000, latestPlayAt: 1_000 },
    ]);
  });

  test("count plays started from the window's start up to its end, both included", () => {
    const track = addTrack(db, { title: "Edges" });
    recordPlay(db, play(track, 999));
    recordPlay(db, play(track, 1_000));
    recordPlay(db, play(track, 2_000));
    recordPlay(db, play(track, 2_001));

    const [totals] = trackPlayTotals(db, { from: 1_000, to: 2_000 });
    assert.equal(totals?.countedPlays, 2);
    assert.equal(totals?.latestPlayAt, 2_000);
  });

  test("an empty window has no totals", () => {
    const track = addTrack(db, { title: "Long ago" });
    recordPlay(db, play(track, 1_000));
    assert.deepEqual(trackPlayTotals(db, { from: 5_000, to: 10_000 }), []);
  });

  test("tracks that left the library drop out", () => {
    const gone = addTrack(db, { title: "Deleted" });
    const kept = addTrack(db, { title: "Kept" });
    recordPlay(db, play(gone, 1_000));
    recordPlay(db, play(kept, 2_000));
    db.delete(schema.tracks).where(eq(schema.tracks.id, gone)).run();

    assert.deepEqual(
      trackPlayTotals(db, { from: null, to: 10_000 }).map((row) => row.id),
      [kept],
    );
  });
});
