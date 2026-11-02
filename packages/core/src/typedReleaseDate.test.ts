import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  TYPED_RELEASE_BUCKETS,
  formatReleaseDate,
  readTypedReleaseDate,
  readTypedReleaseDates,
  releaseDue,
  releaseShownDate,
  releaseTagDate,
  typedReleaseBucket,
  typedReleaseTag,
  withTypedReleaseDate,
} from "./index.ts";

const TODAY = "2026-11-02";

describe("a typed release date", () => {
  test("takes a year, a year and month, or a full date", () => {
    assert.deepEqual(readTypedReleaseDate({ year: "1985", month: "", day: "" }, TODAY), {
      ok: true,
      date: "1985",
    });
    assert.deepEqual(readTypedReleaseDate({ year: "1985", month: "6", day: "" }, TODAY), {
      ok: true,
      date: "1985-06",
    });
    assert.deepEqual(readTypedReleaseDate({ year: " 1985 ", month: "06", day: "21" }, TODAY), {
      ok: true,
      date: "1985-06-21",
    });
    assert.deepEqual(readTypedReleaseDate({ year: "2024", month: "2", day: "29" }, TODAY), {
      ok: true,
      date: "2024-02-29",
    });
  });

  test("an empty year is nothing to save yet, not a mistake", () => {
    assert.deepEqual(readTypedReleaseDate({ year: "", month: "", day: "" }, TODAY), {
      ok: false,
      problem: "empty",
    });
  });

  test("refuses a date that can't be", () => {
    for (const [year, month, day] of [
      ["0000", "", ""],
      ["985", "", ""],
      ["19a5", "", ""],
      ["1985", "13", ""],
      ["1985", "0", ""],
      ["1985", "2", "30"],
      ["2023", "2", "29"],
      ["1985", "4", "31"],
      ["1985", "", "21"],
      ["1985", "6", "32"],
      ["1985", "6", "0"],
      ["2027", "", ""],
      ["2026", "12", ""],
      ["2026", "11", "3"],
    ] as const)
      assert.deepEqual(
        readTypedReleaseDate({ year, month, day }, TODAY),
        { ok: false, problem: "impossible" },
        `${year}-${month}-${day}`,
      );
  });

  test("today is the latest a song can have come out", () => {
    assert.deepEqual(readTypedReleaseDate({ year: "2026", month: "11", day: "2" }, TODAY), {
      ok: true,
      date: "2026-11-02",
    });
    assert.deepEqual(readTypedReleaseDate({ year: "2026", month: "", day: "" }, TODAY), {
      ok: true,
      date: "2026",
    });
  });
});

describe("which date a song shows and sorts by", () => {
  const found = { date: "1968", source: "first-release", retryAt: null } as const;
  const album = { date: "2015-01-01", source: "album", retryAt: 1 } as const;

  test("a typed date wins over everything", () => {
    assert.equal(
      releaseShownDate({ typed: "1970-03", original: "1985", answer: found, year: 2005 }),
      "1970-03",
    );
  });

  test("then the original-date tag, the first release found, the Year, the album's date", () => {
    assert.equal(releaseShownDate({ original: "1985", answer: found, year: 2005 }), "1985");
    assert.equal(releaseShownDate({ answer: found, year: 2005 }), "1968");
    assert.equal(releaseShownDate({ answer: album, year: 2005 }), "2005");
    assert.equal(releaseShownDate({ answer: album }), "2015-01-01");
    assert.equal(releaseShownDate({}), null);
  });

  test("a song with a typed date is never looked up", () => {
    const song = { title: "Hey Jude", artist: "The Beatles" };
    assert.equal(releaseDue(song, null, null, 0), true);
    assert.equal(releaseDue(song, "1970", null, 0), false);
  });
});

describe("the typed dates the Wave account keeps", () => {
  const key = '["hey jude","beatles"]';

  test("a song's date is kept, replaced and cleared under its key", () => {
    const kept = withTypedReleaseDate({}, key, "1968-08-26");
    assert.deepEqual(kept, { [key]: "1968-08-26" });
    assert.deepEqual(withTypedReleaseDate(kept ?? {}, key, "1968"), { [key]: "1968" });
    assert.deepEqual(withTypedReleaseDate(kept ?? {}, key, null), {});
  });

  test("reads back what it stored, and skips what isn't a date", () => {
    assert.deepEqual(readTypedReleaseDates(JSON.stringify({ [key]: "1968" })), { [key]: "1968" });
    assert.deepEqual(readTypedReleaseDates(JSON.stringify({ a: "1968-13", b: 5, c: "1970" })), {
      c: "1970",
    });
    assert.deepEqual(readTypedReleaseDates(null), {});
    assert.deepEqual(readTypedReleaseDates("not json"), {});
  });

  test("songs spread over a few preferences, each song always in the same one", () => {
    const buckets = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const bucket = typedReleaseBucket(`["song ${i}","artist"]`);
      assert.ok(Number.isInteger(bucket) && bucket >= 0 && bucket < TYPED_RELEASE_BUCKETS);
      buckets.add(bucket);
    }
    assert.equal(buckets.size, TYPED_RELEASE_BUCKETS);
    assert.equal(typedReleaseBucket(key), typedReleaseBucket(key));
  });

  test("a preference that would be too long for the account refuses one more song", () => {
    let dates: Record<string, string> | null = {};
    let i = 0;
    while (dates !== null) {
      const next = withTypedReleaseDate(
        dates,
        `["a song with a long title ${i}","artist"]`,
        "1985-06-21",
      );
      if (next === null) break;
      assert.ok(JSON.stringify(next).length <= 16_384);
      dates = next;
      i++;
    }
    assert.ok(i > 100);
    // Changing or clearing a song it holds still works.
    assert.notEqual(
      withTypedReleaseDate(dates ?? {}, '["a song with a long title 0","artist"]', null),
      null,
    );
  });
});

describe("what a typed date does to the song's file", () => {
  const found = { date: "1968", source: "first-release", retryAt: null } as const;

  test("it replaces the original date the file has, where a found one leaves it", () => {
    assert.equal(releaseTagDate({ answer: found, held: "1985", hasFile: true }), null);
    assert.deepEqual(typedReleaseTag({ date: "1970", hasFile: true }), { date: "1970" });
  });

  test("clearing it takes the date out of the file, so the lookup can find one", () => {
    assert.deepEqual(typedReleaseTag({ date: null, hasFile: true }), { date: null });
  });

  test("a song without a file keeps it in the index alone", () => {
    assert.equal(typedReleaseTag({ date: "1970", hasFile: false }), null);
  });
});

describe("a release date as the menu and screen say it", () => {
  test("in English, as precise as it's known", () => {
    assert.equal(formatReleaseDate("1985", "en"), "1985");
    assert.equal(formatReleaseDate("1985-06", "en"), "June 1985");
    assert.equal(formatReleaseDate("1985-06-21", "en"), "June 21, 1985");
  });

  test("in Portuguese, the month in lower case mid-sentence", () => {
    assert.equal(formatReleaseDate("1985", "pt-BR"), "1985");
    assert.equal(formatReleaseDate("1985-06", "pt-BR"), "junho de 1985");
    assert.equal(formatReleaseDate("1985-01-01", "pt-BR"), "1º de janeiro de 1985");
    assert.equal(formatReleaseDate("1985-06-21", "pt-BR"), "21 de junho de 1985");
  });
});
