import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { artistStats, type PlayTotals, type SongListening } from "./index.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const now = Date.UTC(2026, 9, 12, 12);

/** A song's all-time listening; by default one counted play of three minutes, by artist 7. */
const listened = (trackId: number, overrides: Partial<SongListening> = {}): SongListening => ({
  trackId,
  artistId: 7,
  countedPlays: 1,
  listenedMs: 3 * MINUTE,
  lastPlayedAt: now - HOUR,
  ...overrides,
});

describe("artistStats", () => {
  test("an artist whose songs never counted a play is not played yet", () => {
    const stats = artistStats({
      artistId: 7,
      songIds: [1, 2],
      // Only a too-short play of theirs, and another artist's counted play.
      listening: [
        listened(1, { countedPlays: 0, listenedMs: 10_000 }),
        listened(3, { artistId: 8 }),
      ],
      songPlays: [],
      now,
    });

    assert.deepEqual(stats, { played: false });
  });

  test("a played artist reads plays, minutes listened and songs listened out of their songs", () => {
    const stats = artistStats({
      artistId: 7,
      songIds: [1, 2, 3, 4],
      listening: [
        listened(1, { countedPlays: 3, listenedMs: 10 * MINUTE }),
        // Skipped plays: their time counts, they don't.
        listened(2, { countedPlays: 0, listenedMs: 90_000 }),
        listened(3, { countedPlays: 1, listenedMs: 4 * MINUTE }),
        listened(9, { artistId: 8, countedPlays: 6, listenedMs: 30 * MINUTE }),
      ],
      songPlays: [],
      now,
    });

    assert.equal(stats.played, true);
    if (!stats.played) return;
    assert.equal(stats.plays, "4 plays");
    assert.equal(stats.minutesListened, "15 minutes listened");
    assert.equal(stats.songsListened, "2 of 4 songs");
  });

  test("one of each reads in the singular, and large totals with separators", () => {
    const one = artistStats({
      artistId: 7,
      songIds: [1],
      listening: [listened(1, { countedPlays: 1, listenedMs: MINUTE + 5_000 })],
      songPlays: [],
      now,
    });
    const many = artistStats({
      artistId: 7,
      songIds: Array.from({ length: 1_200 }, (_, index) => index),
      listening: [listened(1, { countedPlays: 1_500, listenedMs: 2_000 * MINUTE })],
      songPlays: [],
      now,
    });

    assert.ok(one.played && many.played);
    assert.deepEqual(
      [one.plays, one.minutesListened, one.songsListened],
      ["1 play", "1 minute listened", "1 of 1 song"],
    );
    assert.deepEqual(
      [many.plays, many.minutesListened, many.songsListened],
      ["1,500 plays", "2,000 minutes listened", "1 of 1,200 songs"],
    );
  });

  test("last played is the artist's latest play, counted or not, said as how long ago", () => {
    const lastPlayed = (ago: number): string => {
      const stats = artistStats({
        artistId: 7,
        songIds: [1, 2],
        listening: [
          listened(1, { lastPlayedAt: now - 400 * DAY }),
          listened(2, { countedPlays: 0, lastPlayedAt: now - ago }),
          // Another artist's later play doesn't count.
          listened(3, { artistId: 8, lastPlayedAt: now }),
        ],
        songPlays: [],
        now,
      });
      return stats.played ? stats.lastPlayed : "";
    };

    assert.equal(lastPlayed(20_000), "Last played just now");
    assert.equal(lastPlayed(MINUTE), "Last played 1 minute ago");
    assert.equal(lastPlayed(59 * MINUTE), "Last played 59 minutes ago");
    assert.equal(lastPlayed(HOUR), "Last played 1 hour ago");
    assert.equal(lastPlayed(23 * HOUR + 59 * MINUTE), "Last played 23 hours ago");
    assert.equal(lastPlayed(DAY), "Last played yesterday");
    assert.equal(lastPlayed(2 * DAY), "Last played 2 days ago");
    assert.equal(lastPlayed(6 * DAY), "Last played 6 days ago");
    assert.equal(lastPlayed(7 * DAY), "Last played 1 week ago");
    assert.equal(lastPlayed(29 * DAY), "Last played 4 weeks ago");
    assert.equal(lastPlayed(30 * DAY), "Last played 1 month ago");
    assert.equal(lastPlayed(364 * DAY), "Last played 12 months ago");
    assert.equal(lastPlayed(365 * DAY), "Last played 1 year ago");
    assert.equal(lastPlayed(400 * DAY), "Last played 1 year ago");
    assert.equal(lastPlayed(3 * 365 * DAY), "Last played 1 year ago");
  });

  test("years ago count from the latest play", () => {
    const stats = artistStats({
      artistId: 7,
      songIds: [1],
      listening: [listened(1, { lastPlayedAt: now - 3 * 365 * DAY })],
      songPlays: [],
      now,
    });

    assert.ok(stats.played);
    assert.equal(stats.lastPlayed, "Last played 3 years ago");
  });

  test("most played are the artist's songs ranked as in Stats, the top few", () => {
    const plays = (id: number, countedPlays: number, listenedMs = 3 * MINUTE): PlayTotals => ({
      id,
      sortKey: `song ${id}`,
      countedPlays,
      listenedMs,
      latestPlayAt: now - DAY,
    });
    const stats = artistStats({
      artistId: 7,
      songIds: [1, 2, 3, 4, 5, 6, 7, 8],
      listening: [listened(1)],
      songPlays: [
        plays(1, 2),
        plays(2, 9),
        // Another artist's song, played most of all.
        plays(50, 40),
        plays(3, 4, 5 * MINUTE),
        plays(4, 4, 2 * MINUTE),
        plays(5, 1),
        plays(6, 3),
        plays(7, 1, MINUTE),
      ],
      now,
    });

    assert.ok(stats.played);
    assert.deepEqual(
      stats.mostPlayed.map((song) => [song.id, song.countedPlays]),
      [
        [2, 9],
        [3, 4],
        [4, 4],
        [6, 3],
        [1, 2],
      ],
    );
  });
});
