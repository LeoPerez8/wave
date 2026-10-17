import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  reorderGridShift,
  reorderGridTarget,
  reorderScrollSpeed,
  reorderShift,
  reorderTarget,
} from "./index.ts";

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

describe("reorderTarget among rows of their own heights", () => {
  // An editor under large text: a 60 dp row, then rows that wrap onto two lines.
  const rowHeights = [60, 100, 60, 140, 60];
  const count = rowHeights.length;

  test("a row dragged down takes the next row's place once its bottom passes that row's middle", () => {
    // Row 0's bottom starts at 60; row 1's middle is at 110.
    assert.equal(reorderTarget({ from: 0, distance: 49, rowHeight: rowHeights, count }), 0);
    assert.equal(reorderTarget({ from: 0, distance: 50, rowHeight: rowHeights, count }), 1);
  });

  test("a taller row takes more travel to pass than a short one", () => {
    // From row 2 (bottom at 220): row 3's middle is at 290, row 4's at 390.
    assert.equal(reorderTarget({ from: 2, distance: 69, rowHeight: rowHeights, count }), 2);
    assert.equal(reorderTarget({ from: 2, distance: 70, rowHeight: rowHeights, count }), 3);
    assert.equal(reorderTarget({ from: 2, distance: 170, rowHeight: rowHeights, count }), 4);
  });

  test("a row dragged up takes a row's place once its top passes that row's middle", () => {
    // Row 4's top starts at 360: row 3's middle is at 290, row 1's at 110.
    assert.equal(reorderTarget({ from: 4, distance: -69, rowHeight: rowHeights, count }), 4);
    assert.equal(reorderTarget({ from: 4, distance: -71, rowHeight: rowHeights, count }), 3);
    assert.equal(reorderTarget({ from: 4, distance: -251, rowHeight: rowHeights, count }), 1);
  });

  test("a row dragged past either end of the list lands there", () => {
    assert.equal(reorderTarget({ from: 2, distance: -1000, rowHeight: rowHeights, count }), 0);
    assert.equal(reorderTarget({ from: 2, distance: 1000, rowHeight: rowHeights, count }), 4);
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

  test("a finger (no row height) scrolls the list as it nears an edge", () => {
    // The Playlists list and a playlist's songs: 8 dp a frame at most.
    const finger = { rowHeight: 0, viewport: 560, edge: 56, maxSpeed: 8 };
    assert.equal(reorderScrollSpeed({ ...finger, top: 28 }), -4);
    assert.equal(reorderScrollSpeed({ ...finger, top: 280 }), 0);
    assert.equal(reorderScrollSpeed({ ...finger, top: 532 }), 4);
    assert.equal(reorderScrollSpeed({ ...finger, top: 600 }), 8);
  });
});

describe("reorderGridTarget", () => {
  // Two columns of 180 dp tiles, rows 240 dp apart, nine tiles (the last row holds one).
  const grid = { cellWidth: 180, cellHeight: 240, columns: 2, count: 9 };

  test("a tile dragged right past half the next tile takes its place", () => {
    assert.equal(reorderGridTarget({ ...grid, from: 2, dx: 100, dy: 0 }), 3);
    assert.equal(reorderGridTarget({ ...grid, from: 2, dx: 80, dy: 0 }), 2);
  });

  test("a tile dragged down a row lands under where it was", () => {
    assert.equal(reorderGridTarget({ ...grid, from: 1, dx: 0, dy: 250 }), 3);
    assert.equal(reorderGridTarget({ ...grid, from: 5, dx: -190, dy: -480 }), 0);
  });

  test("a tile dragged past the sides or the top stays in the grid", () => {
    assert.equal(reorderGridTarget({ ...grid, from: 3, dx: 900, dy: 0 }), 3);
    assert.equal(reorderGridTarget({ ...grid, from: 2, dx: -900, dy: 0 }), 2);
    assert.equal(reorderGridTarget({ ...grid, from: 3, dx: 0, dy: -2000 }), 1);
  });

  test("a tile dragged past the last tile lands last", () => {
    assert.equal(reorderGridTarget({ ...grid, from: 1, dx: 0, dy: 2000 }), 8);
    assert.equal(reorderGridTarget({ ...grid, from: 6, dx: 180, dy: 240 }), 8);
  });

  test("with one column it is the list's rule: sideways moves count for nothing", () => {
    const list = { cellWidth: 360, cellHeight: 56, columns: 1, count: 10 };
    assert.equal(reorderGridTarget({ ...list, from: 2, dx: 500, dy: 2.4 * 56 }), 4);
  });
});

describe("reorderGridShift", () => {
  const shifts = (from: number, to: number) =>
    [0, 1, 2, 3, 4, 5].map((index) => reorderGridShift({ index, from, to, columns: 2 }));

  test("dragging tile 1 to 4 moves tiles 2 to 4 back one place, wrapping to the row above", () => {
    assert.deepEqual(shifts(1, 4), [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 1, y: -1 },
      { x: -1, y: 0 },
      { x: 1, y: -1 },
      { x: 0, y: 0 },
    ]);
  });

  test("dragging tile 4 to 1 moves tiles 1 to 3 on one place, wrapping to the row below", () => {
    assert.deepEqual(shifts(4, 1), [
      { x: 0, y: 0 },
      { x: -1, y: 1 },
      { x: 1, y: 0 },
      { x: -1, y: 1 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ]);
  });

  test("with one column, rows move up or down as in a list", () => {
    const column = [0, 1, 2, 3].map((index) =>
      reorderGridShift({ index, from: 0, to: 2, columns: 1 }),
    );
    assert.deepEqual(column, [
      { x: 0, y: 0 },
      { x: 0, y: -1 },
      { x: 0, y: -1 },
      { x: 0, y: 0 },
    ]);
  });
});
