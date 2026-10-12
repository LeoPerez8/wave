import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { listeningOverview, listeningTotals, type SongListening } from "./index.ts";

const MINUTE = 60_000;

/** A song's all-time listening; by default one counted play of three minutes, by artist 1. */
const song = (trackId: number, overrides: Partial<SongListening> = {}): SongListening => ({
  trackId,
  artistId: 1,
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
      song(5, { artistId: null, inLibrary: false, countedPlays: 1, listenedMs: 3 * MINUTE }),
    ]);

    assert.equal(totals.songsListened, 2);
    // Its history still counts towards minutes and plays.
    assert.equal(totals.plays, 10);
    assert.equal(totals.minutesListened, 24);
  });

  test("filtered to an artist, the totals cover only that artist's songs", () => {
    const songs = [
      song(1, { artistId: 7, countedPlays: 2, listenedMs: 8 * MINUTE }),
      song(2, { artistId: 7, countedPlays: 0, listenedMs: 1 * MINUTE }),
      song(3, { artistId: 8, countedPlays: 4, listenedMs: 12 * MINUTE }),
      song(4, { artistId: null, countedPlays: 1, listenedMs: 4 * MINUTE }),
      // Their song since deleted: its plays still count for them, but it isn't one of their songs.
      song(5, { artistId: 7, inLibrary: false, countedPlays: 3, listenedMs: 6 * MINUTE }),
    ];

    assert.deepEqual(listeningTotals(songs, { artistId: 7 }), {
      minutesListened: 15,
      songsListened: 1,
      plays: 5,
      lastPlayedAt: 1_000,
    });
  });

  test("last played is the latest play of any song covered, counted or not", () => {
    const songs = [
      song(1, { artistId: 7, lastPlayedAt: 5_000 }),
      song(2, { artistId: 7, countedPlays: 0, lastPlayedAt: 9_000 }),
      song(3, { artistId: 8, lastPlayedAt: 20_000 }),
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

describe("listeningOverview", () => {
  test("spells each total out with thousands separators and plural wording", () => {
    const overview = listeningOverview(
      { songs: 2_500, albums: 600, artists: 800 },
      { minutesListened: 12_340, songsListened: 1_100, plays: 4_200, lastPlayedAt: 1_000 },
    );

    assert.deepEqual(overview, {
      library: ["2,500 songs", "600 albums", "800 artists"],
      listening: ["12,340 minutes listened", "1,100 songs listened", "4,200 plays"],
    });
  });

  test("uses the singular for one and the plural for none", () => {
    assert.deepEqual(
      listeningOverview(
        { songs: 1, albums: 1, artists: 1 },
        { minutesListened: 1, songsListened: 1, plays: 1, lastPlayedAt: 1_000 },
      ),
      {
        library: ["1 song", "1 album", "1 artist"],
        listening: ["1 minute listened", "1 song listened", "1 play"],
      },
    );
    assert.deepEqual(
      listeningOverview({ songs: 0, albums: 0, artists: 0 }, listeningTotals([])).listening,
      ["0 minutes listened", "0 songs listened", "0 plays"],
    );
  });
});
