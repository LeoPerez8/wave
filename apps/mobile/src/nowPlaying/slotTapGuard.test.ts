import assert from "node:assert/strict";
import { test } from "node:test";

import { slotTapGuard } from "./slotTapGuard.ts";

test("a tap on an edit slot opens its card", () => {
  const guard = slotTapGuard();
  guard.touched();
  assert.equal(guard.tapped(2), true);
});

test("the release that drops a dragged slot doesn't also open its card", () => {
  const guard = slotTapGuard();
  guard.touched();
  guard.dragged(2);
  assert.equal(guard.tapped(2), false);
});

test("after a drag whose release never reached the button, the next tap opens the card", () => {
  const guard = slotTapGuard();
  guard.touched();
  guard.dragged(2);
  // The gesture took the touch, so no press ended it; a new touch starts clean.
  guard.touched();
  assert.equal(guard.tapped(2), true);
});
