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

// A full-width row, 56 dp tall, and a menu kept 8 dp from it.
const near = (top: number) => ({ rect: { top, bottom: top + 56, left: 0, right: 412 }, gap: 8 });

// An album tile on a tablet.
const tile = (left: number, right: number) => ({
  rect: { top: 100, bottom: 400, left, right },
  gap: 8,
});

describe("placeOverlayCard next to an anchor", () => {
  test("a menu opens just below the long-pressed row when it fits there", () => {
    assert.deepEqual(placeOverlayCard({ ...phone, cardHeight: 400, anchor: near(200) }), {
      left: 24,
      top: 264,
      width: 364,
      maxHeight: 811,
      side: "below",
    });
  });

  test("a row near the bottom gets its menu above it instead", () => {
    const frame = placeOverlayCard({ ...phone, cardHeight: 400, anchor: near(600) });
    assert.equal(frame.side, "above");
    assert.equal(frame.top, 192);
  });

  test("the floating tab bar and mini player count as the bottom of the screen", () => {
    const anchor = near(450);
    assert.equal(placeOverlayCard({ ...phone, cardHeight: 300, anchor }).side, "below");
    const frame = placeOverlayCard({ ...phone, cardHeight: 300, anchor, chromeBottom: 136 });
    assert.equal(frame.side, "above");
    assert.equal(frame.top, 142);
    assert.equal(frame.maxHeight, 675);
  });

  test("a menu too tall for either side stays on screen, over the row, on the roomier side", () => {
    const lower = placeOverlayCard({ ...phone, cardHeight: 600, anchor: near(400) });
    assert.deepEqual([lower.side, lower.top], ["below", 267]);
    const higher = placeOverlayCard({ ...phone, cardHeight: 600, anchor: near(500) });
    assert.deepEqual([higher.side, higher.top], ["above", 56]);
  });

  test("a row half under the tab bar still gets a menu clear of it, above the row", () => {
    const frame = placeOverlayCard({
      ...phone,
      cardHeight: 200,
      anchor: near(740),
      chromeBottom: 80,
    });
    assert.deepEqual([frame.side, frame.top], ["above", 532]);
  });

  test("on a wide screen the menu centres under the album tile, kept a margin inside the edges", () => {
    const tablet = { ...phone, window: { width: 1000, height: 1400 }, cardHeight: 300 };
    assert.equal(placeOverlayCard({ ...tablet, anchor: tile(360, 840) }).left, 360);
    assert.equal(placeOverlayCard({ ...tablet, anchor: tile(520, 980) }).left, 496);
    assert.equal(placeOverlayCard({ ...tablet, anchor: tile(20, 480) }).left, 24);
  });
});
