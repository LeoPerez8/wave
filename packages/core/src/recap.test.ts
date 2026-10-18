// Recaps go by the phone's local calendar: run in a zone away from UTC so a
// UTC-bucketing bug shows up.
process.env.TZ = "America/Sao_Paulo";

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  availableRecaps,
  parseRecapId,
  recap,
  recapBack,
  recapBarFill,
  recapForward,
  recapId,
  recapSlides,
  parseOpenedRecaps,
  storedOpenedRecaps,
  withRecapOpened,
  recapTitle,
  recapToAnnounce,
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

const years = (periods: readonly RecapPeriod[]) =>
  periods.filter((period) => period.kind === "year");
const available = (now: number, ...plays: CountedListening[]) => availableRecaps(plays, now);

describe("yearly Recaps", () => {
  const year2026 = { kind: "year", year: 2026 } as const;

  test("a year with 20 hours of counted plays is out on 1 December", () => {
    const plays = [listened(at(2026, 3, 10), 10 * HOUR), listened(at(2026, 11, 2), 10 * HOUR)];
    assert.deepEqual(years(availableRecaps(plays, at(2026, 11, 30, 23, 59))), []);
    assert.deepEqual(years(availableRecaps(plays, at(2026, 12, 1, 0, 0))), [year2026]);
  });

  test("a year under 20 hours of counted plays has no Recap, even once it's over", () => {
    const plays = [listened(at(2026, 3, 10), 20 * HOUR - 1)];
    assert.deepEqual(years(availableRecaps(plays, at(2027, 6, 1))), []);
  });

  test("December's plays reach the year's minimum while it's out", () => {
    const plays = [listened(at(2026, 6, 1), 19 * HOUR)];
    assert.deepEqual(years(availableRecaps(plays, at(2026, 12, 20))), []);
    plays.push(listened(at(2026, 12, 21), HOUR));
    assert.deepEqual(years(availableRecaps(plays, at(2026, 12, 22))), [year2026]);
  });

  test("lists each year above the months of that year, newest first", () => {
    const plays = [
      listened(at(2025, 12, 5), 20 * HOUR),
      listened(at(2026, 8, 5), 18 * HOUR),
      listened(at(2026, 11, 5), 3 * HOUR),
    ];
    assert.deepEqual(availableRecaps(plays, at(2026, 12, 1)), [
      year2026,
      { kind: "month", year: 2026, month: 11 },
      { kind: "month", year: 2026, month: 8 },
      { kind: "year", year: 2025 },
      { kind: "month", year: 2025, month: 12 },
    ]);
  });

  test("covers the local year, and keeps covering it through December", () => {
    assert.deepEqual(recapWindow(year2026), {
      from: at(2026, 1, 1, 0, 0),
      to: at(2027, 1, 1, 0, 0) - 1,
    });
  });

  test("its minutes count the whole year's listening", () => {
    const listening = [
      listened(at(2025, 12, 31, 23, 59), HOUR),
      listened(at(2026, 1, 1, 0, 0), HOUR),
      listened(at(2026, 12, 31, 23, 30), HOUR),
      listened(at(2027, 1, 1, 0, 0), HOUR),
    ];
    assert.equal(recap({ period: year2026, listening, songs: [] }).minutesListened, 120);
  });

  test("is titled and named by its year", () => {
    assert.equal(recapTitle(year2026), "2026");
    assert.equal(recapId(year2026), "2026");
    assert.deepEqual(parseRecapId("2026"), year2026);
  });
});

describe("recapToAnnounce", () => {
  const october2026 = at(2026, 10, 18);

  test("Home announces the newest Recap until it's opened", () => {
    const recaps = available(october2026, listened(at(2026, 9, 5), 3 * HOUR));
    assert.deepEqual(recapToAnnounce(recaps, []), { kind: "month", year: 2026, month: 9 });
    assert.equal(recapToAnnounce(recaps, ["2026-09"]), null);
  });

  test("an older Recap left unopened isn't announced once a newer one is out", () => {
    const recaps = available(
      october2026,
      listened(at(2026, 8, 5), 3 * HOUR),
      listened(at(2026, 9, 5), 3 * HOUR),
    );
    assert.equal(recapToAnnounce(recaps, ["2026-09"]), null);
  });

  test("on 1 December the year and November are both new: the year first, then November", () => {
    const recaps = available(
      at(2026, 12, 1),
      listened(at(2026, 6, 5), 17 * HOUR),
      listened(at(2026, 11, 5), 3 * HOUR),
    );
    assert.deepEqual(recapToAnnounce(recaps, []), { kind: "year", year: 2026 });
    assert.deepEqual(recapToAnnounce(recaps, ["2026"]), {
      kind: "month",
      year: 2026,
      month: 11,
    });
    assert.equal(recapToAnnounce(recaps, ["2026", "2026-11"]), null);
  });

  test("nothing to announce without a Recap", () => {
    assert.equal(recapToAnnounce([], []), null);
  });
});

describe("opened Recaps", () => {
  test("opening a Recap is kept, once, and read back", () => {
    const opened = withRecapOpened(withRecapOpened([], "2026-09"), "2026-09");
    assert.deepEqual(parseOpenedRecaps(storedOpenedRecaps(opened)), ["2026-09"]);
  });

  test("nothing stored, or anything unreadable, is no Recap opened", () => {
    for (const stored of [null, "", "{", "{}"]) assert.deepEqual(parseOpenedRecaps(stored), []);
    assert.deepEqual(parseOpenedRecaps('[1, "2026-09"]'), ["2026-09"]);
  });
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
      ["minutes", "topSongs"],
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
      ["minutes"],
    );
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
