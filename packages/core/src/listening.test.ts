import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  counted,
  listeningOverview,
  listeningTotals,
  summedListeningTotals,
  type SongListening,
} from "./index.ts";

const MINUTE = 60_000;

/** A song's all-time listening; by default one counted play of three minutes, credited to artist 1. */
const song = (trackId: number, overrides: Partial<SongListening> = {}): SongListening => ({
  trackId,
  artistIds: [1],
  inLibrary: true,
  countedPlays: 1,
  listenedMs: 3 * MINUTE,
  lastPlayedAt: 1_000,
  ...overrides,
});

describe("listeningTotals", () => {
  test("minutes listened add up every play; plays count only counted plays", () => {
    const totals = listeningTotals([
      song(1, { countedPlays: 2, listenedMs: 7 * MINUTE }),
      // Only skipped or too-short plays: time listened, but no counted play.
      song(2, { countedPlays: 0, listenedMs: 2 * MINUTE }),
    ]);

    assert.equal(totals.minutesListened, 9);
    assert.equal(totals.plays, 2);
  });

  test("songs listened are the songs still in the library with a counted play", () => {
    const totals = listeningTotals([
      song(1, { countedPlays: 3 }),
      song(2, { countedPlays: 1 }),
      // Played, but never long enough to count.
      song(3, { countedPlays: 0, listenedMs: 20_000 }),
      // Counted plays of a song since removed from the library.
      song(4, { inLibrary: false, countedPlays: 5, listenedMs: 15 * MINUTE }),
      // One removed before Wave kept the artist of deleted songs.
      song(5, { artistIds: [], inLibrary: false, countedPlays: 1, listenedMs: 3 * MINUTE }),
    ]);

    assert.equal(totals.songsListened, 2);
    // Its history still counts towards minutes and plays.
    assert.equal(totals.plays, 10);
    assert.equal(totals.minutesListened, 24);
  });

  test("filtered to an artist, the totals cover only that artist's songs", () => {
    const songs = [
      song(1, { artistIds: [7], countedPlays: 2, listenedMs: 8 * MINUTE }),
      song(2, { artistIds: [7], countedPlays: 0, listenedMs: 1 * MINUTE }),
      song(3, { artistIds: [8], countedPlays: 4, listenedMs: 12 * MINUTE }),
      song(4, { artistIds: [], countedPlays: 1, listenedMs: 4 * MINUTE }),
      // Their song since deleted: its plays still count for them, but it isn't one of their songs.
      song(5, { artistIds: [7], inLibrary: false, countedPlays: 3, listenedMs: 6 * MINUTE }),
    ];

    assert.deepEqual(listeningTotals(songs, { artistId: 7 }), {
      minutesListened: 15,
      songsListened: 1,
      plays: 5,
      lastPlayedAt: 1_000,
    });
  });

  test("a collaboration counts for each artist it credits, and once in the whole history", () => {
    const songs = [
      // "Ariana Grande, Doja Cat": Ariana is 7, Doja Cat is 8.
      song(1, { artistIds: [7, 8], countedPlays: 2, listenedMs: 6 * MINUTE, lastPlayedAt: 4_000 }),
      song(2, { artistIds: [7], countedPlays: 1, listenedMs: 3 * MINUTE }),
      // A deleted collaboration still counts for both.
      song(3, { artistIds: [8, 7], inLibrary: false, countedPlays: 1, listenedMs: 2 * MINUTE }),
    ];

    assert.deepEqual(listeningTotals(songs, { artistId: 7 }), {
      minutesListened: 11,
      songsListened: 2,
      plays: 4,
      lastPlayedAt: 4_000,
    });
    assert.deepEqual(listeningTotals(songs, { artistId: 8 }), {
      minutesListened: 8,
      songsListened: 1,
      plays: 3,
      lastPlayedAt: 4_000,
    });
    assert.deepEqual(listeningTotals(songs), {
      minutesListened: 11,
      songsListened: 2,
      plays: 4,
      lastPlayedAt: 4_000,
    });
  });

  test("last played is the latest play of any song covered, counted or not", () => {
    const songs = [
      song(1, { artistIds: [7], lastPlayedAt: 5_000 }),
      song(2, { artistIds: [7], countedPlays: 0, lastPlayedAt: 9_000 }),
      song(3, { artistIds: [8], lastPlayedAt: 20_000 }),
    ];

    assert.equal(listeningTotals(songs, { artistId: 7 }).lastPlayedAt, 9_000);
    assert.equal(listeningTotals(songs).lastPlayedAt, 20_000);
  });

  test("with no listening at all, every total is zero and nothing was last played", () => {
    assert.deepEqual(listeningTotals([]), {
      minutesListened: 0,
      songsListened: 0,
      plays: 0,
      lastPlayedAt: null,
    });
  });
});

describe("summedListeningTotals", () => {
  test("reads the history the store summed already as the same totals, in whole minutes", () => {
    assert.deepEqual(
      summedListeningTotals({
        listenedMs: 9 * MINUTE + 59_999,
        countedPlays: 12_500,
        songsListened: 2_400,
        lastPlayedAt: 20_000,
      }),
      { minutesListened: 9, songsListened: 2_400, plays: 12_500, lastPlayedAt: 20_000 },
    );
  });

  test("agrees with the songs' totals when their listening is summed", () => {
    const songs = [
      song(1, { countedPlays: 2, listenedMs: 7 * MINUTE + 30_000, lastPlayedAt: 3_000 }),
      song(2, { countedPlays: 0, listenedMs: 40_000, lastPlayedAt: 9_000 }),
      song(3, { inLibrary: false, countedPlays: 4, listenedMs: 12 * MINUTE }),
    ];

    assert.deepEqual(
      summedListeningTotals({
        listenedMs: 7 * MINUTE + 30_000 + 40_000 + 12 * MINUTE,
        countedPlays: 6,
        songsListened: 1,
        lastPlayedAt: 9_000,
      }),
      listeningTotals(songs),
    );
  });

  test("with nothing played, every total is zero and nothing was last played", () => {
    assert.deepEqual(
      summedListeningTotals({
        listenedMs: 0,
        countedPlays: 0,
        songsListened: 0,
        lastPlayedAt: null,
      }),
      { minutesListened: 0, songsListened: 0, plays: 0, lastPlayedAt: null },
    );
  });
});

describe("listeningOverview", () => {
  test("Home's Stats facts show listening first, then the library, with grouped values", () => {
    assert.deepEqual(
      listeningOverview(
        { songs: 2_500, albums: 600, artists: 800 },
        { minutesListened: 48_119, songsListened: 1_100, plays: 4_200, lastPlayedAt: 1_000 },
      ),
      [
        { label: "Time listened", value: "801 h" },
        { label: "Plays", value: "4,200" },
        { label: "Songs listened", value: "1,100" },
        { label: "Songs", value: "2,500" },
        { label: "Albums", value: "600" },
        { label: "Artists", value: "800" },
      ],
    );
  });

  test("listening time uses whole hours, or whole minutes below an hour", () => {
    for (const [minutes, expected] of [
      [0, "0 min"],
      [1, "1 min"],
      [59, "59 min"],
      [60, "1 h"],
      [119, "1 h"],
      [120, "2 h"],
      [48_119, "801 h"],
      [60_000, "1,000 h"],
    ] as const) {
      const facts = listeningOverview(
        { songs: 0, albums: 0, artists: 0 },
        { ...listeningTotals([]), minutesListened: minutes },
      );
      assert.equal(facts[0]?.value, expected, `${minutes} minutes`);
    }
  });
});

describe("counted", () => {
  test("a count with thousands separators, the singular for one and the plural otherwise", () => {
    assert.equal(counted(1, "song"), "1 song");
    assert.equal(counted(0, "song"), "0 songs");
    assert.equal(counted(12_500, "album"), "12,500 albums");
    assert.equal(counted(2, "minute listened", "minutes listened"), "2 minutes listened");
  });
});
