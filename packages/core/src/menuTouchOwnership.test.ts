import assert from "node:assert/strict";
import { test } from "node:test";

import { createMenuTouchOwnership, playerTouchAllowed } from "./index.ts";

test("a held menu suppresses both player pans, including a release queued before it opened", () => {
  const owner = createMenuTouchOwnership();
  const touch = owner.get().revision;
  const queuedOpen = () => owner.allows(touch);
  const queuedSkip = () => owner.allows(touch);
  owner.claim();
  assert.equal(queuedOpen(), false);
  assert.equal(queuedSkip(), false);
  assert.equal(playerTouchAllowed(owner.get(), owner.get().revision), false);
  owner.release();
  assert.equal(queuedOpen(), false);
  assert.equal(queuedSkip(), false);
  assert.equal(owner.allows(owner.get().revision), true);
});

test("clearing ownership admits a fresh gesture, and another menu invalidates that gesture too", () => {
  const owner = createMenuTouchOwnership();
  const oldTouch = owner.get().revision;
  owner.claim();
  owner.release();
  assert.equal(owner.get().held, false);
  assert.equal(owner.allows(oldTouch), false);
  const freshTouch = owner.get().revision;
  assert.equal(owner.allows(freshTouch), true);
  owner.claim();
  assert.equal(owner.allows(freshTouch), false);
  owner.release();
  assert.equal(owner.allows(freshTouch), false);
  assert.equal(owner.allows(owner.get().revision), true);
});
