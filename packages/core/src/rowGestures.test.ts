import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { dragTargetIndex, resolveRemoveSwipe } from "./index.ts";

// Track rows are 56 dp tall.
const rowHeight = 56;

describe("dragTargetIndex", () => {
  test("a row dragged down past half of the next row takes its place", () => {
    assert.equal(dragTargetIndex({ from: 2, offsetY: 29, rowHeight, count: 10 }), 3);
    assert.equal(dragTargetIndex({ from: 2, offsetY: 27, rowHeight, count: 10 }), 2);
  });

  test("dragging up works the same way", () => {
    assert.equal(dragTargetIndex({ from: 5, offsetY: -3 * rowHeight, rowHeight, count: 10 }), 2);
  });

  test("dragging past either end of the list lands at that end", () => {
    assert.equal(dragTargetIndex({ from: 1, offsetY: -400, rowHeight, count: 10 }), 0);
    assert.equal(dragTargetIndex({ from: 8, offsetY: 400, rowHeight, count: 10 }), 9);
  });
});

// A track row on the S24+ (412 dp window minus the 24 dp margins).
const width = 364;

describe("resolveRemoveSwipe", () => {
  test("a slow swipe left past a third of the row removes it", () => {
    assert.equal(resolveRemoveSwipe({ translationX: -130, velocityX: -50, width }), true);
  });

  test("a slow, short swipe settles back", () => {
    assert.equal(resolveRemoveSwipe({ translationX: -100, velocityX: -50, width }), false);
  });

  test("a quick flick left removes the row even when it is short", () => {
    assert.equal(resolveRemoveSwipe({ translationX: -40, velocityX: -900, width }), true);
  });

  test("flicking back to the right changes your mind", () => {
    assert.equal(resolveRemoveSwipe({ translationX: -200, velocityX: 900, width }), false);
  });

  test("swiping right never removes", () => {
    assert.equal(resolveRemoveSwipe({ translationX: 200, velocityX: 900, width }), false);
  });
});
