import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  STATS_PERIODS,
  STATS_SEE_ALL,
  STATS_TOP,
  albumPlayTotals,
  artistPlayTotals,
  rankPlays,
  statsWindow,
  type CreditedPlayTotals,
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

  test("the periods are offered from the shortest to all time, with a short tab label", () => {
    assert.deepEqual(
      STATS_PERIODS.map((period) => [period.id, period.label, period.tab]),
      [
        ["week", "Last 7 days", "7 days"],
        ["month", "Last 30 days", "30 days"],
        ["year", "Last 12 months", "12 months"],
        ["all", "All time", "All time"],
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
    assert.deepEqual(ids(rankPlays(tied.toReversed(), STATS_TOP)), [2, 3, 4, 1]);
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

/** Totals for the tracks of one album by one track artist. */
const credit = (
  album: { id: number; sort: string },
  artist: { id: number; sort: string },
  overrides: Partial<CreditedPlayTotals> = {},
): CreditedPlayTotals => ({
  albumId: album.id,
  albumSort: album.sort,
  artistId: artist.id,
  artistSort: artist.sort,
  countedPlays: 1,
  listenedMs: 180_000,
  latestPlayAt: 1_000,
  ...overrides,
});

const kindOfBlue = { id: 1, sort: "kind of blue" };
const jazzHits = { id: 2, sort: "jazz hits" };
const miles = { id: 10, sort: "davis, miles" };
const coltrane = { id: 11, sort: "coltrane, john" };
const evans = { id: 12, sort: "evans, bill" };

describe("album and artist rankings", () => {
  // Jazz Hits is a compilation (album artist "Various Artists", id 99): its
  // tracks are by Miles Davis and John Coltrane.
  const credits = [
    credit(kindOfBlue, miles, { countedPlays: 3, listenedMs: 600_000, latestPlayAt: 5_000 }),
    credit(jazzHits, miles, { countedPlays: 2, listenedMs: 300_000, latestPlayAt: 9_000 }),
    credit(jazzHits, coltrane, { countedPlays: 4, listenedMs: 700_000, latestPlayAt: 2_000 }),
    credit(kindOfBlue, evans, { countedPlays: 0, listenedMs: 0, latestPlayAt: 0 }),
  ];

  test("an album sums the plays of all its tracks, whoever plays on them", () => {
    assert.deepEqual(rankPlays(albumPlayTotals(credits), STATS_TOP), [
      {
        id: jazzHits.id,
        sortKey: "jazz hits",
        countedPlays: 6,
        listenedMs: 1_000_000,
        latestPlayAt: 9_000,
      },
      {
        id: kindOfBlue.id,
        sortKey: "kind of blue",
        countedPlays: 3,
        listenedMs: 600_000,
        latestPlayAt: 5_000,
      },
    ]);
  });

  test("artists are credited by track artist, so a compilation credits its real artists", () => {
    const ranking = rankPlays(artistPlayTotals(credits), STATS_TOP);
    assert.deepEqual(ranking, [
      {
        id: miles.id,
        sortKey: "davis, miles",
        countedPlays: 5,
        listenedMs: 900_000,
        latestPlayAt: 9_000,
      },
      {
        id: coltrane.id,
        sortKey: "coltrane, john",
        countedPlays: 4,
        listenedMs: 700_000,
        latestPlayAt: 2_000,
      },
    ]);
    assert.ok(!ranking.some((entry) => entry.id === 99), "Various Artists is never credited");
  });

  test("albums and artists rank and cut like songs", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      credit(
        { id: i + 1, sort: `album ${i}` },
        { id: 100 + i, sort: `artist ${i}` },
        {
          countedPlays: 50 - i,
        },
      ),
    );
    assert.deepEqual(
      ids(rankPlays(albumPlayTotals(many), STATS_TOP)),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    );
    assert.deepEqual(ids(rankPlays(artistPlayTotals(many), 3)), [100, 101, 102]);
  });

  test("nothing played, nothing ranked", () => {
    assert.deepEqual(albumPlayTotals([]), []);
    assert.deepEqual(artistPlayTotals([]), []);
  });
});
