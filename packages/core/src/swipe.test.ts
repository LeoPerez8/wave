import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { resolveSkipSwipe, settleScreenSwipe } from "./index.ts";

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

describe("settleScreenSwipe", () => {
  test("a drag left past a third of the width turns from the player to the Queue", () => {
    assert.equal(
      settleScreenSwipe({ from: "player", translationX: -130, velocityX: -50, width }),
      "queue",
    );
  });

  test("a short slow drag settles back on the screen it started from", () => {
    assert.equal(
      settleScreenSwipe({ from: "player", translationX: -100, velocityX: -50, width }),
      "player",
    );
    assert.equal(
      settleScreenSwipe({ from: "queue", translationX: 100, velocityX: 50, width }),
      "queue",
    );
  });

  test("a drag right past a third of the width returns from the Queue to the player", () => {
    assert.equal(
      settleScreenSwipe({ from: "queue", translationX: 130, velocityX: 50, width }),
      "player",
    );
  });

  test("a quick flick turns the page even when it is short", () => {
    assert.equal(
      settleScreenSwipe({ from: "player", translationX: -40, velocityX: -900, width }),
      "queue",
    );
    assert.equal(
      settleScreenSwipe({ from: "queue", translationX: 40, velocityX: 900, width }),
      "player",
    );
  });

  test("a flick back against the drag cancels it, even past the distance", () => {
    assert.equal(
      settleScreenSwipe({ from: "player", translationX: -200, velocityX: 900, width }),
      "player",
    );
    assert.equal(
      settleScreenSwipe({ from: "queue", translationX: 200, velocityX: -900, width }),
      "queue",
    );
  });

  test("a drag away from the other screen turns nothing, however far or fast", () => {
    assert.equal(
      settleScreenSwipe({ from: "player", translationX: 200, velocityX: 900, width }),
      "player",
    );
    assert.equal(
      settleScreenSwipe({ from: "queue", translationX: -200, velocityX: -900, width }),
      "queue",
    );
  });
});
