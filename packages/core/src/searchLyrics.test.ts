import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { findLyricMatch } from "./index.ts";

describe("findLyricMatch", () => {
  test("matches ordered contiguous words across punctuation, case and accents", () => {
    assert.deepEqual(findLyricMatch("[00:01.00]Trem-Balá!", "trem bala"), {
      line: "Trem-Balá!",
      ranges: [
        { start: 0, end: 4 },
        { start: 5, end: 9 },
      ],
    });
  });

  test("does not match reordered or separated query words", () => {
    assert.equal(findLyricMatch("Bala trem", "trem bala"), null);
    assert.equal(findLyricMatch("trem, and then bala", "trem bala"), null);
  });

  test("apostrophes do not split a lyric search word", () => {
    assert.deepEqual(findLyricMatch("Don't stop!", "dont stop"), {
      line: "Don't stop!",
      ranges: [
        { start: 0, end: 5 },
        { start: 6, end: 10 },
      ],
    });
  });
});
