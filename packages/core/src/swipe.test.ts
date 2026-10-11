import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { resolveSkipSwipe } from "./index.ts";

// A mini player about as wide as it is on the S24+ (412 dp window minus margins).
const width = 364;

describe("resolveSkipSwipe", () => {
  test("a slow drag left past a third of the width skips to the next track", () => {
    assert.equal(resolveSkipSwipe({ translationX: -130, velocityX: -50, width }), "next");
  });

  test("a slow drag right past a third of the width goes to the previous track", () => {
    assert.equal(resolveSkipSwipe({ translationX: 130, velocityX: 50, width }), "previous");
  });

  test("a slow, short drag settles back without skipping", () => {
    assert.equal(resolveSkipSwipe({ translationX: -100, velocityX: -50, width }), null);
    assert.equal(resolveSkipSwipe({ translationX: 100, velocityX: 50, width }), null);
  });

  test("a quick flick skips even when it is short", () => {
    assert.equal(resolveSkipSwipe({ translationX: -40, velocityX: -900, width }), "next");
    assert.equal(resolveSkipSwipe({ translationX: 40, velocityX: 900, width }), "previous");
  });

  test("flicking back against the drag changes your mind, even past the distance", () => {
    assert.equal(resolveSkipSwipe({ translationX: -200, velocityX: 900, width }), null);
    assert.equal(resolveSkipSwipe({ translationX: 200, velocityX: -900, width }), null);
  });

  test("a tremor with speed but almost no travel does not skip", () => {
    assert.equal(resolveSkipSwipe({ translationX: -4, velocityX: -900, width }), null);
  });
});
