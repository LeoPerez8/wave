import assert from "node:assert/strict";
import { test } from "node:test";

import { readShuffleCardOpenings, shuffleCardOpened, shuffleLineShows } from "./index.ts";

test("the card's first three openings explain every kind", () => {
  for (const openedBefore of [0, 1, 2]) {
    for (const index of [0, 1]) {
      assert.equal(shuffleLineShows({ openedBefore, underFinger: undefined, index }), true);
    }
  }
});

test("from the fourth opening the card shows names only", () => {
  for (const openedBefore of [3, 4, 50]) {
    for (const index of [0, 1]) {
      assert.equal(shuffleLineShows({ openedBefore, underFinger: undefined, index }), false);
    }
  }
});

test("after its first openings the card explains only the entry under the finger", () => {
  assert.equal(shuffleLineShows({ openedBefore: 3, underFinger: 1, index: 1 }), true);
  assert.equal(shuffleLineShows({ openedBefore: 3, underFinger: 1, index: 0 }), false);
  assert.equal(shuffleLineShows({ openedBefore: 7, underFinger: 0, index: 0 }), true);
  assert.equal(shuffleLineShows({ openedBefore: 7, underFinger: 0, index: 1 }), false);
});

test("a fresh device explains every kind on the card's first three openings, then names only", () => {
  let stored: string | null = null;
  const explained: boolean[] = [];
  for (let opening = 1; opening <= 5; opening += 1) {
    const openedBefore = readShuffleCardOpenings(stored);
    explained.push(shuffleLineShows({ openedBefore, underFinger: undefined, index: 0 }));
    stored = String(shuffleCardOpened(openedBefore));
  }
  assert.deepEqual(explained, [true, true, true, false, false]);
});

test("the count stops once the card has stopped explaining, so it isn't written again", () => {
  assert.equal(shuffleCardOpened(3), 3);
  assert.equal(shuffleCardOpened(9), 3);
});

test("a stored count that isn't a count reads as a fresh device", () => {
  for (const stored of [null, "", "abc", "-2", "1.5"]) {
    assert.equal(readShuffleCardOpenings(stored), 0, String(stored));
  }
  assert.equal(readShuffleCardOpenings("2"), 2);
});
