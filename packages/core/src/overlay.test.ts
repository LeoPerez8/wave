import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { placeOverlayCard } from "./index.ts";

// A phone in portrait, in dp: status bar on top, gesture bar below.
const phone = {
  window: { width: 412, height: 915 },
  insets: { top: 32, bottom: 24, left: 0, right: 0 },
  margin: 24,
  maxWidth: 480,
};

describe("placeOverlayCard", () => {
  test("a short card floats in the middle of the screen, a margin in from each side", () => {
    assert.deepEqual(placeOverlayCard({ ...phone, cardHeight: 300 }), {
      left: 24,
      top: 312,
      width: 364,
      maxHeight: 811,
    });
  });

  test("a card taller than the screen stops a margin short of both system bars", () => {
    const frame = placeOverlayCard({ ...phone, cardHeight: 2000 });
    assert.equal(frame.top, 56);
    assert.equal(frame.maxHeight, 811);
  });

  test("on a wide screen the card keeps its maximum width, centred clear of a side cutout", () => {
    const frame = placeOverlayCard({
      ...phone,
      window: { width: 915, height: 412 },
      insets: { top: 24, bottom: 0, left: 32, right: 0 },
      cardHeight: 200,
    });
    assert.deepEqual(frame, { left: 234, top: 118, width: 480, maxHeight: 340 });
  });
});
