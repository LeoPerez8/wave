import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { resolveRemoveSwipe } from "./index.ts";

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
