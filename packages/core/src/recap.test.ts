// Recaps go by the phone's local calendar: run in a zone away from UTC so a
// UTC-bucketing bug shows up.
process.env.TZ = "America/Sao_Paulo";

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  availableRecaps,
  genreFamily,
  parseRecapId,
  recap,
  recapBack,
  recapBarFill,
  recapForward,
  recapHourLabel,
  recapId,
  recapWeekdayLabel,
  recapSlides,
  recapWindow,
  type CountedListening,
  type PlayTotals,
  type RecapPeriod,
} from "./index.ts";

const HOUR = 60 * 60 * 1000;
/** A local time: month 1-12. */
const at = (year: number, month: number, day: number, hour = 12, minute = 0): number =>
  new Date(year, month - 1, day, hour, minute).getTime();
const listened = (startedAt: number, listenedMs: number): CountedListening => ({
  startedAt,
  listenedMs,
});

describe("availableRecaps", () => {
  test("a month with 3 hours of counted plays is offered once it has ended", () => {
    const plays = [listened(at(2026, 9, 10), 3 * HOUR)];
    assert.deepEqual(availableRecaps(plays, at(2026, 10, 1, 0, 0)), [
      { kind: "month", year: 2026, month: 9 },
    ]);
  });

  test("the month still under way has no Recap, however much was played", () => {
    const plays = [listened(at(2026, 10, 2), 10 * HOUR)];
    assert.deepEqual(availableRecaps(plays, at(2026, 10, 31, 23, 59)), []);
  });

  test("a month under 3 hours of counted plays has no Recap", () => {
    const plays = [listened(at(2026, 9, 1), 2 * HOUR), listened(at(2026, 9, 30), HOUR - 1)];
    assert.deepEqual(availableRecaps(plays, at(2026, 12, 1)), []);
  });

  test("plays are summed over the month to reach the minimum", () => {
    const plays = [
      listened(at(2026, 9, 1), HOUR),
      listened(at(2026, 9, 15), HOUR),
      listened(at(2026, 9, 30), HOUR),
    ];
    assert.equal(availableRecaps(plays, at(2026, 12, 1)).length, 1);
  });

  test("a play late on the last evening belongs to that month in local time", () => {
    // 23:30 on 30 September in São Paulo is already 1 October in UTC.
    const plays = [listened(at(2026, 9, 30, 23, 30), 3 * HOUR)];
    assert.deepEqual(availableRecaps(plays, at(2026, 10, 1, 0, 0)), [
      { kind: "month", year: 2026, month: 9 },
    ]);
  });

  test("lists every past month with a Recap, newest first, across years", () => {
    const plays = [
      listened(at(2025, 12, 5), 3 * HOUR),
      listened(at(2026, 8, 5), 4 * HOUR),
      listened(at(2026, 7, 5), HOUR),
      listened(at(2026, 2, 5), 5 * HOUR),
    ];
    assert.deepEqual(availableRecaps(plays, at(2026, 10, 18)), [
      { kind: "month", year: 2026, month: 8 },
      { kind: "month", year: 2026, month: 2 },
      { kind: "month", year: 2025, month: 12 },
    ]);
  });
});

const september: RecapPeriod = { kind: "month", year: 2026, month: 9 };
const song = (
  id: number,
  countedPlays: number,
  listenedMs = countedPlays * 180_000,
): PlayTotals => ({
  id,
  sortKey: `song ${id}`,
  countedPlays,
  listenedMs,
  latestPlayAt: at(2026, 9, 20),
});

describe("recap", () => {
  test("minutes listened sum the month's counted listening, whole minutes", () => {
    const listening = [
      listened(at(2026, 8, 31, 23, 50), HOUR),
      listened(at(2026, 9, 1, 0, 0), 2 * HOUR),
      listened(at(2026, 9, 30, 23, 59), HOUR + 59_999),
      listened(at(2026, 10, 1, 0, 0), HOUR),
    ];
    assert.equal(recap({ period: september, listening, songs: [] }).minutesListened, 180);
  });

  test("the top 5 songs are the month's most counted plays, the top one first", () => {
    const songs = [song(1, 4), song(2, 9), song(3, 1), song(4, 7), song(5, 2), song(6, 12)];
    assert.deepEqual(
      recap({ period: september, listening: [], songs }).topSongs.map((entry) => [
        entry.id,
        entry.countedPlays,
      ]),
      [
        [6, 12],
        [2, 9],
        [4, 7],
        [1, 4],
        [5, 2],
      ],
    );
  });

  test("the top 5 artists are the month's most counted plays, the top one first", () => {
    const artists = [
      song(11, 3),
      song(12, 8),
      song(13, 1),
      song(14, 5),
      song(15, 2),
      song(16, 0),
      song(17, 4),
    ];
    assert.deepEqual(
      recap({ period: september, listening: [], songs: [], artists }).topArtists.map(
        (entry) => entry.id,
      ),
      [12, 14, 17, 11, 15],
    );
  });

  test("the top album is the month's most played, none without plays", () => {
    const albums = [song(21, 2), song(22, 6), song(23, 6, 1)];
    assert.equal(recap({ period: september, listening: [], songs: [], albums }).topAlbum?.id, 22);
    assert.equal(recap({ period: september, listening: [], songs: [] }).topAlbum, null);
  });

  test("top genres rank families by counted plays, songs without a genre left out", () => {
    const songs = [song(1, 4), song(2, 3), song(3, 2), song(4, 10), song(5, 1), song(6, 7)];
    const songGenres = [
      { id: 1, genre: "Metalcore" },
      { id: 2, genre: "Rock" },
      // A song in two families adds half its plays to each.
      { id: 3, genre: "Hard Rock", genres: ["Hard Rock", "Pop"] },
      { id: 4, genre: null },
      { id: 5, genre: "Alternative Metal" },
    ];
    assert.deepEqual(
      recap({ period: september, listening: [], songs, songGenres }).topGenres.map((entry) => [
        entry.family.name,
        entry.share,
      ]),
      [
        ["Metal", 0.5],
        ["Rock", 0.4],
        ["Pop", 0.1],
      ],
    );
  });

  test("no top genres when none of the month's songs has a genre", () => {
    const songs = [song(1, 4)];
    assert.deepEqual(
      recap({ period: september, listening: [], songs, songGenres: [{ id: 1, genre: "" }] })
        .topGenres,
      [],
    );
  });

  test("habits: the local hour and weekday with the most counted listening", () => {
    const listening = [
      listened(at(2026, 8, 31, 8, 0), 5 * HOUR), // August: not this Recap's
      listened(at(2026, 9, 3, 22, 0), 60 * 60_000), // Thursday
      listened(at(2026, 9, 10, 22, 15), 50 * 60_000), // Thursday
      listened(at(2026, 9, 4, 8, 0), 40 * 60_000), // Friday
      listened(at(2026, 9, 11, 13, 0), 80 * 60_000), // Friday
    ];
    const habits = recap({ period: september, listening, songs: [] }).habits;
    assert.equal(habits?.peakHour, 22);
    assert.equal(habits?.peakWeekday, 5);
  });

  test("habits: the longest run of days with a counted play, within the month", () => {
    const days = [
      [8, 30],
      [8, 31],
      [9, 1],
      [9, 2],
      [9, 20],
      [9, 21],
      [9, 22],
      [9, 30],
    ] as const;
    const listening = days.map(([month, day]) => listened(at(2026, month, day, 23, 45), HOUR));
    assert.equal(recap({ period: september, listening, songs: [] }).habits?.longestStreakDays, 3);
  });

  test("no habits without counted listening in the month", () => {
    assert.equal(recap({ period: september, listening: [], songs: [] }).habits, null);
  });

  test("discovered artists had their first counted play in the month, most played first", () => {
    const artists = [song(11, 9), song(12, 2), song(13, 5), song(14, 4)];
    const artistFirstPlays = [
      { id: 11, firstPlayAt: at(2026, 8, 31, 23, 59) },
      { id: 12, firstPlayAt: at(2026, 9, 1, 0, 0) },
      { id: 13, firstPlayAt: at(2026, 9, 30, 23, 30) },
    ];
    assert.deepEqual(
      recap({
        period: september,
        listening: [],
        songs: [],
        artists,
        artistFirstPlays,
      }).discoveredArtists.map((entry) => entry.id),
      [13, 12],
    );
  });

  test("a Recap is titled by its month", () => {
    assert.equal(recap({ period: september, listening: [], songs: [] }).title, "September 2026");
  });
});

describe("recapSlides", () => {
  test("minutes listened, then the top songs with the top one leading", () => {
    const songs = [song(1, 4), song(2, 9)];
    const slides = recapSlides(
      recap({ period: september, listening: [listened(at(2026, 9, 3), 3 * HOUR)], songs }),
    );
    assert.deepEqual(
      slides.map((slide) => slide.kind),
      ["minutes", "topSongs", "habits", "summary"],
    );
    const [minutes, top] = slides;
    assert.deepEqual(minutes, { kind: "minutes", minutes: 180 });
    assert.deepEqual(top?.kind === "topSongs" ? top.songs.map((entry) => entry.id) : [], [2, 1]);
  });

  test("no top-songs slide when none of the month's songs is still in the Library", () => {
    const slides = recapSlides(
      recap({ period: september, listening: [listened(at(2026, 9, 3), 3 * HOUR)], songs: [] }),
    );
    assert.deepEqual(
      slides.map((slide) => slide.kind),
      ["minutes", "habits", "summary"],
    );
  });

  test("every slide in order: minutes, songs, artists, album, genres, habits, discoveries, summary", () => {
    const slides = recapSlides(
      recap({
        period: september,
        listening: [listened(at(2026, 9, 3, 21, 0), 3 * HOUR)],
        songs: [song(1, 4)],
        artists: [song(11, 4)],
        albums: [song(21, 4)],
        songGenres: [{ id: 1, genre: "Rock" }],
        artistFirstPlays: [{ id: 11, firstPlayAt: at(2026, 9, 3, 21, 0) }],
      }),
    );
    assert.deepEqual(slides, [
      { kind: "minutes", minutes: 180 },
      { kind: "topSongs", songs: [song(1, 4)] },
      { kind: "topArtists", artists: [song(11, 4)] },
      { kind: "topAlbum", album: song(21, 4) },
      { kind: "topGenres", genres: [{ family: genreFamily("Rock"), share: 1 }] },
      { kind: "habits", peakHour: 21, peakWeekday: 4, longestStreakDays: 1 },
      { kind: "discovered", artists: [song(11, 4)] },
      {
        kind: "summary",
        minutes: 180,
        songs: [song(1, 4)],
        artists: [song(11, 4)],
        genre: genreFamily("Rock"),
      },
    ]);
  });

  test("a slide with nothing to show is skipped: no genres, nothing discovered", () => {
    const slides = recapSlides(
      recap({
        period: september,
        listening: [listened(at(2026, 9, 3), 3 * HOUR)],
        songs: [song(1, 4)],
        artists: [song(11, 4)],
        albums: [song(21, 4)],
        songGenres: [{ id: 1, genre: null }],
        artistFirstPlays: [{ id: 11, firstPlayAt: at(2025, 1, 1) }],
      }),
    );
    assert.deepEqual(
      slides.map((slide) => slide.kind),
      ["minutes", "topSongs", "topArtists", "topAlbum", "habits", "summary"],
    );
  });
});

describe("recap summary card", () => {
  test("the last slide sums the Recap up: minutes, top 5 songs, top 5 artists, top genre", () => {
    const slides = recapSlides(
      recap({
        period: september,
        listening: [listened(at(2026, 9, 3), 3 * HOUR)],
        songs: [1, 2, 3, 4, 5, 6].map((id) => song(id, 10 - id)),
        artists: [11, 12, 13, 14, 15, 16].map((id) => song(id, 20 - id)),
        songGenres: [
          { id: 1, genre: "Jazz" },
          { id: 2, genre: "Rock" },
          { id: 3, genre: "Rock" },
        ],
      }),
    );
    assert.deepEqual(slides.at(-1), {
      kind: "summary",
      minutes: 180,
      songs: [1, 2, 3, 4, 5].map((id) => song(id, 10 - id)),
      artists: [11, 12, 13, 14, 15].map((id) => song(id, 20 - id)),
      genre: genreFamily("Rock"),
    });
  });

  test("with no genres and nothing in the Library, the card still has the minutes", () => {
    const slides = recapSlides(
      recap({ period: september, listening: [listened(at(2026, 9, 3), 3 * HOUR)], songs: [] }),
    );
    assert.deepEqual(slides.at(-1), {
      kind: "summary",
      minutes: 180,
      songs: [],
      artists: [],
      genre: null,
    });
  });
});

describe("habit labels", () => {
  test("an hour reads as a 12-hour clock hour", () => {
    assert.deepEqual([0, 9, 12, 22].map(recapHourLabel), ["12 AM", "9 AM", "12 PM", "10 PM"]);
  });

  test("a weekday reads by name, its plural for habits", () => {
    assert.deepEqual([0, 5].map(recapWeekdayLabel), ["Sundays", "Fridays"]);
  });
});

describe("recap viewer", () => {
  test("tapping right goes to the next slide and closes after the last", () => {
    assert.equal(recapForward(0, 2), 1);
    assert.equal(recapForward(1, 2), null);
  });

  test("tapping left goes to the previous slide, and restarts the first", () => {
    assert.equal(recapBack(1), 0);
    assert.equal(recapBack(0), 0);
  });

  test("progress bars: full before the slide shown, filling on it, empty after", () => {
    assert.deepEqual(
      [0, 1, 2].map((bar) => recapBarFill(bar, 1, 0.25)),
      [1, 0.25, 0],
    );
  });
});

describe("recapWindow", () => {
  test("covers the local month, from its first instant to its last", () => {
    assert.deepEqual(recapWindow(september), {
      from: at(2026, 9, 1, 0, 0),
      to: at(2026, 10, 1, 0, 0) - 1,
    });
  });

  test("December runs up to New Year", () => {
    assert.equal(
      recapWindow({ kind: "month", year: 2026, month: 12 }).to,
      at(2027, 1, 1, 0, 0) - 1,
    );
  });
});

describe("recapId", () => {
  test("names a month and reads back", () => {
    assert.equal(recapId(september), "2026-09");
    assert.deepEqual(parseRecapId("2026-09"), september);
  });

  test("anything else isn't a Recap", () => {
    for (const id of ["2026-13", "2026-00", "2026-9", "september", "", "2026-09-01"]) {
      assert.equal(parseRecapId(id), null, id);
    }
  });
});
