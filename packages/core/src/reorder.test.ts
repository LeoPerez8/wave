import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { reorderShift, reorderTarget } from "./index.ts";

const rowHeight = 56;

describe("reorderTarget", () => {
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
