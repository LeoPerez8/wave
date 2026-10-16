import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { reorderScrollSpeed, reorderShift, reorderTarget } from "./index.ts";

// Track rows are 56 dp tall.
const rowHeight = 56;

describe("reorderTarget", () => {
  test("a row dragged down past half of the next row takes its place", () => {
    assert.equal(reorderTarget({ from: 2, distance: 29, rowHeight, count: 10 }), 3);
    assert.equal(reorderTarget({ from: 2, distance: 27, rowHeight, count: 10 }), 2);
  });

  test("dragging up works the same way", () => {
    assert.equal(reorderTarget({ from: 5, distance: -3 * rowHeight, rowHeight, count: 10 }), 2);
  });

  test("dragging a row down past two rows drops it two places later", () => {
    assert.equal(reorderTarget({ from: 1, distance: 2.4 * rowHeight, rowHeight, count: 10 }), 3);
  });

  test("a row dragged past the top of the list lands first", () => {
    assert.equal(reorderTarget({ from: 2, distance: -10 * rowHeight, rowHeight, count: 10 }), 0);
  });

  test("a row dragged past the bottom of the list lands last", () => {
    assert.equal(reorderTarget({ from: 7, distance: 10 * rowHeight, rowHeight, count: 10 }), 9);
  });
});

describe("reorderShift", () => {
  test("dragging row 1 down to 3 moves rows 2 and 3 up one place, and no others", () => {
    const shifts = [0, 1, 2, 3, 4].map((index) => reorderShift({ index, from: 1, to: 3 }));
    assert.deepEqual(shifts, [0, 0, -1, -1, 0]);
  });

  test("dragging row 3 up to 1 moves rows 1 and 2 down one place, and no others", () => {
    const shifts = [0, 1, 2, 3, 4].map((index) => reorderShift({ index, from: 3, to: 1 }));
    assert.deepEqual(shifts, [0, 1, 1, 0, 0]);
  });
});

describe("reorderScrollSpeed", () => {
  // Up Next: 56 dp rows in a 560 dp tall list, scrolling from a row's height
  // away from an edge, at up to 672 dp a second.
  const list = { rowHeight, viewport: 560, edge: 56, maxSpeed: 672 };

  test("a row away from both edges doesn't scroll the list", () => {
    assert.equal(reorderScrollSpeed({ ...list, top: 56 }), 0);
    assert.equal(reorderScrollSpeed({ ...list, top: 250 }), 0);
    assert.equal(reorderScrollSpeed({ ...list, top: 448 }), 0);
  });

  test("a row halfway into the top edge scrolls up at half speed", () => {
    assert.equal(reorderScrollSpeed({ ...list, top: 28 }), -336);
  });

  test("a row at or past the top edge scrolls up at full speed", () => {
    assert.equal(reorderScrollSpeed({ ...list, top: 0 }), -672);
    assert.equal(reorderScrollSpeed({ ...list, top: -40 }), -672);
  });

  test("a row halfway into the bottom edge scrolls down at half speed", () => {
    // Its bottom is 28 dp from the list's bottom.
    assert.equal(reorderScrollSpeed({ ...list, top: 476 }), 336);
  });

  test("a row at or past the bottom edge scrolls down at full speed", () => {
    assert.equal(reorderScrollSpeed({ ...list, top: 504 }), 672);
    assert.equal(reorderScrollSpeed({ ...list, top: 600 }), 672);
  });
});
