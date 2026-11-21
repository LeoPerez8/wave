import assert from "node:assert/strict";
import { test } from "node:test";

import { KEPT_BLOCK_DAYS, keptTotalsPlan, playBuckets } from "./keptPlayTotals.ts";

const DAY = 86_400_000;
const BLOCK = KEPT_BLOCK_DAYS * DAY;

test("a play falls in its UTC day and in its 32-day block", () => {
  assert.equal(KEPT_BLOCK_DAYS, 32);
  assert.deepEqual(playBuckets(0), { day: 0, block: 0 });
  assert.deepEqual(playBuckets(DAY - 1), { day: 0, block: 0 });
  assert.deepEqual(playBuckets(32 * DAY), { day: 32, block: 1 });
  assert.deepEqual(playBuckets(65 * DAY + 5), { day: 65, block: 2 });
});

test("a window inside one day is read from its plays alone", () => {
  assert.deepEqual(keptTotalsPlan({ from: 10 * DAY + 100, to: 10 * DAY + 500 }), {
    blocks: null,
    days: [],
    plays: [{ from: 10 * DAY + 100, to: 10 * DAY + 500 }],
  });
});

test("a week reads its whole days from the kept totals and the two partial days from the plays", () => {
  const from = 40 * DAY + 3_600_000;
  const to = 47 * DAY + 3_600_000;
  assert.deepEqual(keptTotalsPlan({ from, to }), {
    blocks: null,
    days: [{ from: 41, to: 46 }],
    plays: [
      { from, to: 41 * DAY - 1 },
      { from: 47 * DAY, to },
    ],
  });
});

test("a window that starts or ends on a day boundary reads no plays at that end", () => {
  assert.deepEqual(keptTotalsPlan({ from: 41 * DAY, to: 47 * DAY - 1 }), {
    blocks: null,
    days: [{ from: 41, to: 46 }],
    plays: [],
  });
});

test("a year reads its whole blocks, the days around them and the partial days", () => {
  const from = 3 * BLOCK - 5 * DAY - 7;
  const to = 15 * BLOCK + 2 * DAY + 9;
  assert.deepEqual(keptTotalsPlan({ from, to }), {
    blocks: { from: 3, to: 14 },
    days: [
      { from: 3 * 32 - 5, to: 3 * 32 - 1 },
      { from: 15 * 32, to: 15 * 32 + 1 },
    ],
    plays: [
      { from, to: (3 * 32 - 5) * DAY - 1 },
      { from: (15 * 32 + 2) * DAY, to },
    ],
  });
});

test("all time reads every block before the window's end", () => {
  const to = 20 * BLOCK + 3 * DAY + 11;
  assert.deepEqual(keptTotalsPlan({ from: null, to }), {
    blocks: { from: 0, to: 19 },
    days: [{ from: 20 * 32, to: 20 * 32 + 2 }],
    plays: [{ from: (20 * 32 + 3) * DAY, to }],
  });
});

test("an empty or reversed window reads nothing", () => {
  assert.deepEqual(keptTotalsPlan({ from: 5 * DAY, to: 5 * DAY - 1 }), {
    blocks: null,
    days: [],
    plays: [],
  });
});
