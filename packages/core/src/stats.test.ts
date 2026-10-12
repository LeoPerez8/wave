import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  STATS_PERIODS,
  STATS_SEE_ALL,
  STATS_TOP,
  rankPlays,
  statsWindow,
  type PlayTotals,
} from "./index.ts";

const DAY = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 9, 11, 15, 30);

describe("statsWindow", () => {
  test("last 7 days starts exactly 7 days before now and ends now", () => {
    assert.deepEqual(statsWindow("week", now), { from: now - 7 * DAY, to: now });
  });

  test("last 30 days starts exactly 30 days before now", () => {
    assert.deepEqual(statsWindow("month", now), { from: now - 30 * DAY, to: now });
  });

  test("last 12 months starts at the same moment a year earlier", () => {
    assert.deepEqual(statsWindow("year", now), { from: Date.UTC(2025, 9, 11, 15, 30), to: now });
    // Across a leap day the window is 366 days long.
    const march = Date.UTC(2028, 2, 1);
    assert.equal(march - (statsWindow("year", march).from ?? 0), 366 * DAY);
  });

  test("from a leap day, last 12 months starts on the last day of February", () => {
    const leapDay = Date.UTC(2028, 1, 29, 8);
    assert.equal(statsWindow("year", leapDay).from, Date.UTC(2027, 1, 28, 8));
  });

  test("all time has no start", () => {
    assert.deepEqual(statsWindow("all", now), { from: null, to: now });
  });

  test("the periods are offered from the shortest to all time", () => {
    assert.deepEqual(
      STATS_PERIODS.map((period) => [period.id, period.label]),
      [
        ["week", "Last 7 days"],
        ["month", "Last 30 days"],
        ["year", "Last 12 months"],
        ["all", "All time"],
      ],
    );
  });
});

/** An entity's totals; only what a test cares about needs saying. */
const totals = (id: number, overrides: Partial<PlayTotals> = {}): PlayTotals => ({
  id,
  sortKey: `song ${String(id).padStart(3, "0")}`,
  countedPlays: 1,
  listenedMs: 180_000,
  latestPlayAt: 1_000,
  ...overrides,
});

const ids = (ranking: readonly PlayTotals[]) => ranking.map((entry) => entry.id);

describe("rankPlays", () => {
  test("orders by counted plays, most first", () => {
    const ranking = rankPlays(
      [totals(1, { countedPlays: 2 }), totals(2, { countedPlays: 5 }), totals(3)],
      STATS_TOP,
    );
    assert.deepEqual(ids(ranking), [2, 1, 3]);
  });

  test("breaks a tie in plays by listened time, then by the most recent play", () => {
    const ranking = rankPlays(
      [
        totals(1, { countedPlays: 3, listenedMs: 500_000, latestPlayAt: 1_000 }),
        totals(2, { countedPlays: 3, listenedMs: 500_000, latestPlayAt: 9_000 }),
        totals(3, { countedPlays: 3, listenedMs: 900_000, latestPlayAt: 1 }),
      ],
      STATS_TOP,
    );
    assert.deepEqual(ids(ranking), [3, 2, 1]);
  });

  test("a complete tie is settled by sort key, then id, whatever the input order", () => {
    const tied = [
      totals(4, { sortKey: "b" }),
      totals(2, { sortKey: "a" }),
      totals(3, { sortKey: "b" }),
      totals(1, { sortKey: "c" }),
    ];
    assert.deepEqual(ids(rankPlays(tied, STATS_TOP)), [2, 3, 4, 1]);
    assert.deepEqual(ids(rankPlays([...tied].reverse(), STATS_TOP)), [2, 3, 4, 1]);
  });

  test("leaves out entities without a counted play", () => {
    const ranking = rankPlays(
      [totals(1, { countedPlays: 0, listenedMs: 60_000 }), totals(2)],
      STATS_TOP,
    );
    assert.deepEqual(ids(ranking), [2]);
  });

  test("cuts the ranking to the top 10, or 100 for See all", () => {
    assert.equal(STATS_TOP, 10);
    assert.equal(STATS_SEE_ALL, 100);
    const many = Array.from({ length: 150 }, (_, i) => totals(i + 1, { countedPlays: 200 - i }));

    assert.deepEqual(ids(rankPlays(many, STATS_TOP)), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const all = rankPlays(many, STATS_SEE_ALL);
    assert.equal(all.length, 100);
    assert.equal(all.at(-1)?.id, 100);
  });

  test("a short ranking keeps every entity", () => {
    assert.deepEqual(ids(rankPlays([totals(1), totals(2)], STATS_TOP)), [1, 2]);
    assert.deepEqual(rankPlays([], STATS_TOP), []);
  });

  test("keeps the caller's own fields on each entry", () => {
    const [entry] = rankPlays([{ ...totals(7), title: "Blue in Green" }], STATS_TOP);
    assert.equal(entry?.title, "Blue in Green");
  });
});
