import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { rowWindow, windowRows } from "./index.ts";

// Track rows are 56 dp tall; a screen shows 800 dp of list.
const rowHeight = 56;
const viewport = 800;

describe("rowWindow", () => {
  test("on opening, renders the rows under the header plus a screenful below", () => {
    // Rows start under a 600 dp header; 800 dp of overscan reaches 1600 dp: rows 0–17.
    assert.deepEqual(rowWindow({ scroll: 0, viewport, top: 600, rowHeight, count: 1000 }), {
      start: 0,
      end: 18,
    });
  });

  test("scrolled down, also keeps a screenful above the screen", () => {
    // Screen shows 10,000–10,800 dp: rows from 8,600 dp (153) to 11,000 dp (row 196).
    assert.deepEqual(rowWindow({ scroll: 10_000, viewport, top: 600, rowHeight, count: 1000 }), {
      start: 153,
      end: 197,
    });
  });

  test("stops at the last row", () => {
    assert.deepEqual(rowWindow({ scroll: 0, viewport, top: 0, rowHeight, count: 5 }), {
      start: 0,
      end: 5,
    });
  });

  test("keeps the current window while the screen still has half a screenful to spare in it", () => {
    const current = { start: 153, end: 197 };
    // Scrolled 300 dp further: the screen ends at 11,100 dp, 1,400 dp before the window does.
    const view = { scroll: 10_300, viewport, top: 600, rowHeight, count: 1000 };
    assert.equal(rowWindow(view, current), current);
  });

  test("a window past the last row is trimmed once rows are removed", () => {
    const view = { scroll: 0, viewport, top: 600, rowHeight, count: 5 };
    assert.deepEqual(rowWindow(view, { start: 0, end: 18 }), { start: 0, end: 5 });
  });

  test("moves the window once the screen comes within half a screenful of its edge", () => {
    const current = { start: 153, end: 197 };
    // The window ends at 11,632 dp; a screen ending at 11,300 dp is 332 dp from it. The new
    // window spans 9,700–12,100 dp again a screenful either side: rows 162 to 205.
    const view = { scroll: 10_500, viewport, top: 600, rowHeight, count: 1000 };
    assert.deepEqual(rowWindow(view, current), { start: 162, end: 206 });
  });
});

describe("windowRows", () => {
  test("mounts the rows of the window, in order", () => {
    assert.deepEqual(windowRows({ start: 10, end: 14 }, -1), [10, 11, 12, 13]);
  });

  test("keeps a dragged row mounted after it scrolls out of the window", () => {
    assert.deepEqual(windowRows({ start: 10, end: 14 }, 2), [2, 10, 11, 12, 13]);
    assert.deepEqual(windowRows({ start: 10, end: 14 }, 40), [10, 11, 12, 13, 40]);
  });

  test("a dragged row inside the window is not mounted twice", () => {
    assert.deepEqual(windowRows({ start: 10, end: 14 }, 12), [10, 11, 12, 13]);
  });
});
