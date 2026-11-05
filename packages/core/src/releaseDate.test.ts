import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeTrack } from "./library.ts";
import { releaseAnswer } from "./releaseLookup.ts";
import { readReleaseDate } from "./releaseDate.ts";
import { readTypedReleaseDates } from "./typedReleaseDate.ts";

test("a release date is a year, a year and month, or a full date", () => {
  for (const date of ["1985", "1985-06", "1985-06-21"]) assert.equal(readReleaseDate(date), date);
  for (const date of ["85", "1985-13", "1985-06-32", "1985-6", "1985-06-21T00:00", "", 1985, null])
    assert.equal(readReleaseDate(date), null, String(date));
});

test("year 0000 is no date, whether a tag, an answer or a typed date holds it", () => {
  assert.equal(readReleaseDate("0000"), null);
  assert.equal(readReleaseDate("0000-00-00"), null);
  assert.equal(normalizeTrack({ path: "/song.mp3", releaseDate: "0000" }).releaseDate, null);
  const answer = releaseAnswer(
    ["GBABC9500001"],
    [{ recordings: [{ isrcs: ["GBABC9500001"], "first-release-date": "0000" }] }],
    null,
    null,
    0,
  );
  assert.equal(answer.date, null);
  assert.deepEqual(readTypedReleaseDates('{"song":"0000"}'), {});
});
