import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { relatedPages, relatedRowsThatFit } from "./index.ts";

/** "6×2" for two pages of six, as the ticket writes them. */
const paged = (count: number, fit: number): string => {
  const { pageSize, shown } = relatedPages(count, fit);
  return pageSize === 0 ? "none" : `${pageSize}×${shown / pageSize}`;
};

describe("Related pages", () => {
  test("12 songs with 6 rows fitting are two pages of 6", () => {
    assert.deepEqual(relatedPages(12, 6), { pageSize: 6, shown: 12 });
  });

  test("13 songs are two pages of 6 with the last song left out", () => {
    assert.deepEqual(relatedPages(13, 6), { pageSize: 6, shown: 12 });
  });

  test("11 songs are two pages of 5, which shows more than one page of 6", () => {
    assert.deepEqual(relatedPages(11, 6), { pageSize: 5, shown: 10 });
  });

  test("7 songs are one page of 6", () => {
    assert.deepEqual(relatedPages(7, 6), { pageSize: 6, shown: 6 });
  });

  test("no more songs than fit are one page of all of them", () => {
    assert.deepEqual(relatedPages(3, 6), { pageSize: 3, shown: 3 });
    assert.deepEqual(relatedPages(6, 6), { pageSize: 6, shown: 6 });
    assert.deepEqual(relatedPages(5, 5), { pageSize: 5, shown: 5 });
    assert.deepEqual(relatedPages(1, 4), { pageSize: 1, shown: 1 });
  });

  test("no songs are no page", () => {
    for (const fit of [4, 5, 6]) assert.deepEqual(relatedPages(0, fit), { pageSize: 0, shown: 0 });
  });

  test("two sizes that show as many songs give the larger one", () => {
    // 12 fill three pages of 4 and two of 6; 20 fill five of 4 and four of 5.
    assert.equal(paged(12, 6), "6×2");
    assert.equal(paged(20, 5), "5×4");
    assert.equal(paged(24, 6), "6×4");
  });

  test("every count from 0 to 30 at 6 rows", () => {
    assert.deepEqual(
      Array.from({ length: 31 }, (_, count) => paged(count, 6)),
      [
        "none",
        "1×1",
        "2×1",
        "3×1",
        "4×1",
        "5×1",
        "6×1",
        "6×1",
        "4×2",
        "4×2",
        "5×2",
        "5×2",
        "6×2",
        "6×2",
        "6×2",
        "5×3",
        "4×4",
        "4×4",
        "6×3",
        "6×3",
        "5×4",
        "5×4",
        "5×4",
        "5×4",
        "6×4",
        "5×5",
        "5×5",
        "5×5",
        "4×7",
        "4×7",
        "6×5",
      ],
    );
  });

  test("every count from 0 to 30 at 5 rows", () => {
    assert.deepEqual(
      Array.from({ length: 31 }, (_, count) => paged(count, 5)),
      [
        "none",
        "1×1",
        "2×1",
        "3×1",
        "4×1",
        "5×1",
        "5×1",
        "5×1",
        "4×2",
        "4×2",
        "5×2",
        "5×2",
        "4×3",
        "4×3",
        "4×3",
        "5×3",
        "4×4",
        "4×4",
        "4×4",
        "4×4",
        "5×4",
        "5×4",
        "5×4",
        "5×4",
        "4×6",
        "5×5",
        "5×5",
        "5×5",
        "4×7",
        "4×7",
        "5×6",
      ],
    );
  });

  test("every count from 0 to 30 at 4 rows", () => {
    assert.deepEqual(
      Array.from({ length: 31 }, (_, count) => paged(count, 4)),
      Array.from({ length: 31 }, (_, count) =>
        count === 0 ? "none" : count < 4 ? `${count}×1` : `4×${Math.floor(count / 4)}`,
      ),
    );
  });

  test("the songs left out are the ones past the last full page", () => {
    // 14 songs at 5 rows: three pages of 4 hold the first twelve, in order.
    const songs = Array.from({ length: 14 }, (_, index) => `song ${index + 1}`);
    const { pageSize, shown } = relatedPages(songs.length, 5);
    assert.deepEqual(songs.slice(shown), ["song 13", "song 14"]);
    assert.deepEqual(songs.slice(pageSize, pageSize * 2), ["song 5", "song 6", "song 7", "song 8"]);
  });

  test("a fit outside 4 to 6 pages as the nearest of them", () => {
    assert.deepEqual(relatedPages(13, 9), relatedPages(13, 6));
    assert.deepEqual(relatedPages(9, 2), relatedPages(9, 4));
    assert.deepEqual(relatedPages(9, 5.7), relatedPages(9, 5));
  });
});

describe("Related rows that fit", () => {
  test("as many whole rows as the space holds, 6 at most", () => {
    assert.equal(relatedRowsThatFit(56 * 5, 56), 5);
    assert.equal(relatedRowsThatFit(56 * 5 + 55, 56), 5);
    assert.equal(relatedRowsThatFit(56 * 9, 56), 6);
  });

  test("4 when fewer fit, so the screen scrolls", () => {
    assert.equal(relatedRowsThatFit(56 * 3, 56), 4);
    assert.equal(relatedRowsThatFit(0, 56), 4);
  });

  test("4 for a space or a row not measured yet", () => {
    assert.equal(relatedRowsThatFit(Number.NaN, 56), 4);
    assert.equal(relatedRowsThatFit(400, 0), 4);
  });
});
