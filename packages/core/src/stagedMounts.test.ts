import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { stagedMounts } from "./index.ts";

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
