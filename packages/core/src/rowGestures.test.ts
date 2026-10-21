import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { resolveRowSwipe, rowSwipeArmed } from "./index.ts";

// A track row on the S24+ (412 dp window minus the 24 dp margins).
const width = 364;
const both = { left: true, right: true };

describe("rowSwipeArmed", () => {
  test("a row dragged past a third of its width arms that side", () => {
    assert.equal(rowSwipeArmed({ translationX: -130, width }), "left");
    assert.equal(rowSwipeArmed({ translationX: 130, width }), "right");
  });

  test("a row dragged less than a third isn't armed", () => {
    assert.equal(rowSwipeArmed({ translationX: -100, width }), null);
    assert.equal(rowSwipeArmed({ translationX: 0, width }), null);
  });
});

describe("resolveRowSwipe", () => {
  test("letting go past the threshold runs that side's action", () => {
    assert.equal(resolveRowSwipe({ translationX: -130, velocityX: -50, width }, both), "left");
    assert.equal(resolveRowSwipe({ translationX: 200, velocityX: 50, width }, both), "right");
  });

  test("letting go before the threshold springs back, however fast", () => {
    assert.equal(resolveRowSwipe({ translationX: -100, velocityX: -50, width }, both), null);
    assert.equal(resolveRowSwipe({ translationX: 40, velocityX: 900, width }, both), null);
  });

  test("flicking back against the drag changes your mind", () => {
    assert.equal(resolveRowSwipe({ translationX: -200, velocityX: 900, width }, both), null);
    assert.equal(resolveRowSwipe({ translationX: 200, velocityX: -900, width }, both), null);
  });

  test("a side the row has no action for never runs", () => {
    const rightOnly = { left: false, right: true };
    assert.equal(resolveRowSwipe({ translationX: -200, velocityX: -50, width }, rightOnly), null);
    assert.equal(resolveRowSwipe({ translationX: 200, velocityX: 50, width }, rightOnly), "right");
  });
});
