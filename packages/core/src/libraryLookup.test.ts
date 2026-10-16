import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  libraryLookupProgress,
  readLibraryLookupSummary,
  writeLibraryLookupSummary,
} from "./index.ts";

describe("libraryLookupProgress", () => {
  test("says how far the run is, N of M, for Settings and the notification", () => {
    assert.deepEqual(libraryLookupProgress(3, 120), {
      title: "Fixing songs…",
      detail: "3 of 120",
      line: "Fixing songs… 3 of 120",
    });
  });

  test("counts with thousands separators", () => {
    assert.equal(libraryLookupProgress(1250, 12000).detail, "1,250 of 12,000");
  });

  test("has no count before the songs are known", () => {
    assert.deepEqual(libraryLookupProgress(0, 0), {
      title: "Fixing songs…",
      detail: null,
      line: "Fixing songs…",
    });
  });
});

describe("the summary kept until it's seen", () => {
  const summary = {
    title: "Songs fixed",
    message: "12 fixed · 3 not found · 1 failed",
  };

  test("reads back what was written", () => {
    assert.deepEqual(readLibraryLookupSummary(writeLibraryLookupSummary(summary)), summary);
  });

  test("is none when nothing is kept", () => {
    assert.equal(readLibraryLookupSummary(null), null);
  });

  test("is none when what is kept isn't a summary", () => {
    assert.equal(readLibraryLookupSummary("not json"), null);
    assert.equal(readLibraryLookupSummary("null"), null);
    assert.equal(readLibraryLookupSummary('{"title":"Songs fixed"}'), null);
    assert.equal(readLibraryLookupSummary('{"title":1,"message":"x"}'), null);
  });
});
