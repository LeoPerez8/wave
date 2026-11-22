import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { listMounts, pagerMounts, stagedMounts } from "./index.ts";

describe("stagedMounts", () => {
  test("the first frame mounts the sections that start inside the viewport, the next one the rest", () => {
    assert.deepEqual(stagedMounts({ estimates: [100, 100, 100, 100, 100], viewport: 250 }), [3, 5]);
  });

  test("room between sections pushes the later ones down", () => {
    assert.deepEqual(stagedMounts({ estimates: [100, 100, 100], viewport: 200, gap: 50 }), [2, 3]);
  });

  test("a section taller than the viewport doesn't hold back the next frame", () => {
    assert.deepEqual(stagedMounts({ estimates: [1000, 10, 10, 500], viewport: 200 }), [1, 4]);
  });

  test("each later frame mounts about one viewport more", () => {
    assert.deepEqual(
      stagedMounts({ estimates: Array(10).fill(100), viewport: 300 }),
      [3, 6, 9, 10],
    );
  });

  test("a page that fits mounts whole in its first frame", () => {
    assert.deepEqual(stagedMounts({ estimates: [50, 50], viewport: 800 }), [2]);
  });

  test("an empty page mounts nothing", () => {
    assert.deepEqual(stagedMounts({ estimates: [], viewport: 800 }), [0]);
  });
});

describe("pagerMounts", () => {
  test("the first frame mounts only the page in sight, the next one its neighbour, then the next", () => {
    assert.deepEqual(pagerMounts({ count: 3, index: 0 }), { order: [0, 1, 2], counts: [1, 2, 3] });
  });

  test("a row opened on its last page mounts that page first, then one step further a frame", () => {
    assert.deepEqual(pagerMounts({ count: 3, index: 2 }), { order: [2, 1, 0], counts: [1, 2, 3] });
  });

  test("pages further away mount a frame later each, nearest first", () => {
    assert.deepEqual(pagerMounts({ count: 5, index: 2 }), {
      order: [2, 1, 3, 0, 4],
      counts: [1, 3, 5],
    });
  });

  test("one page mounts in the first frame", () => {
    assert.deepEqual(pagerMounts({ count: 1, index: 0 }), { order: [0], counts: [1] });
  });

  test("a page in sight past the ends is taken as the nearest one", () => {
    assert.deepEqual(pagerMounts({ count: 2, index: 7 }), { order: [1, 0], counts: [1, 2] });
  });

  test("no pages mount nothing", () => {
    assert.deepEqual(pagerMounts({ count: 0, index: 0 }), { order: [], counts: [0] });
  });
});

describe("listMounts", () => {
  test("a long list grows a few rows a frame until a screen is filled, then takes the rest at once", () => {
    // A virtualized list mounts only what is on screen, so the rest of the rows cost nothing.
    assert.deepEqual(listMounts({ count: 300, perFrame: 3, screen: 16 }), [3, 6, 9, 12, 15, 300]);
  });

  test("a list shorter than a screen ends when its last row mounts", () => {
    assert.deepEqual(listMounts({ count: 5, perFrame: 3, screen: 16 }), [3, 5]);
  });

  test("a list that fits one frame's rows mounts whole at once", () => {
    assert.deepEqual(listMounts({ count: 2, perFrame: 3, screen: 16 }), [2]);
  });

  test("an empty list mounts nothing", () => {
    assert.deepEqual(listMounts({ count: 0, perFrame: 3, screen: 16 }), [0]);
  });

  test("every frame mounts at least one row", () => {
    assert.deepEqual(listMounts({ count: 4, perFrame: 0, screen: 3 }), [1, 2, 4]);
  });
});
