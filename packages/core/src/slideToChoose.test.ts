import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { moveSlide, slideEntry, slideTicks, startSlide } from "./index.ts";

// A menu card's entries in the window, in dp: three 56 dp lines below a heading.
const entries = [
  { left: 24, right: 388, top: 400, bottom: 456 },
  { left: 24, right: 388, top: 456, bottom: 512 },
  { left: 24, right: 388, top: 512, bottom: 568 },
];
const SLOP = 8;

// The finger went down on a row above the card.
const held = startSlide({ x: 200, y: 360 });

describe("slide to choose", () => {
  test("after sliding onto an entry, that entry runs on release", () => {
    const slide = moveSlide(held, { x: 210, y: 470 }, SLOP);
    assert.equal(slideEntry(slide, { x: 210, y: 470 }, entries), 1);
  });

  test("a finger that hasn't slid chooses nothing, even where the card covers its row", () => {
    const covered = startSlide({ x: 200, y: 420 });
    const jitter = moveSlide(covered, { x: 205, y: 425 }, SLOP);
    assert.equal(slideEntry(jitter, { x: 205, y: 425 }, entries), undefined);
  });

  test("once it has slid, coming back over its starting entry chooses that entry", () => {
    const covered = startSlide({ x: 200, y: 420 });
    const away = moveSlide(covered, { x: 200, y: 500 }, SLOP);
    const back = moveSlide(away, { x: 200, y: 420 }, SLOP);
    assert.equal(slideEntry(back, { x: 200, y: 420 }, entries), 0);
  });

  test("over the heading or the veil, nothing runs", () => {
    const slide = moveSlide(held, { x: 200, y: 380 }, SLOP);
    assert.equal(slideEntry(slide, { x: 200, y: 380 }, entries), undefined);
    assert.equal(slideEntry(slide, { x: 10, y: 470 }, entries), undefined);
    assert.equal(slideEntry(slide, { x: 200, y: 700 }, entries), undefined);
  });

  test("on the line between two entries, the lower one is under the finger", () => {
    const slide = moveSlide(held, { x: 200, y: 456 }, SLOP);
    assert.equal(slideEntry(slide, { x: 200, y: 456 }, entries), 1);
  });

  test("entries scrolled out of the card's list can't be chosen", () => {
    // The list shows 400–540; the third entry is half hidden below its bottom edge.
    const viewport = { left: 24, right: 388, top: 400, bottom: 540 };
    const slide = moveSlide(held, { x: 200, y: 550 }, SLOP);
    assert.equal(slideEntry(slide, { x: 200, y: 530 }, entries, viewport), 2);
    assert.equal(slideEntry(slide, { x: 200, y: 550 }, entries, viewport), undefined);
  });

  test("an entry not laid out yet is skipped", () => {
    const slide = moveSlide(held, { x: 200, y: 470 }, SLOP);
    assert.equal(slideEntry(slide, { x: 200, y: 470 }, [entries[0], undefined]), undefined);
  });
});

describe("haptic tick while sliding", () => {
  test("moving onto an entry from another ticks", () => {
    assert.equal(slideTicks(0, 1), true);
  });

  test("sliding off every entry doesn't tick", () => {
    assert.equal(slideTicks(1, undefined), false);
  });

  test("moving within the same entry ticks only once", () => {
    assert.equal(slideTicks(undefined, 2), true);
    assert.equal(slideTicks(2, 2), false);
  });

  test("coming back onto an entry after leaving every entry ticks again", () => {
    assert.equal(slideTicks(undefined, 1), true);
  });
});
