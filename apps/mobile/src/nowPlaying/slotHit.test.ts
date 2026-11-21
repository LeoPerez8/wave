import assert from "node:assert/strict";
import { test } from "node:test";

import { slotRectsInFrame, slotUnderFinger } from "./slotHit.ts";

/** A 48 dp slot whose top left corner is at ([left], [top]) in the window. */
const slotAt = (left: number, top: number) => ({
  left,
  top,
  right: left + 48,
  bottom: top + 48,
});

/** The footer's five slots and the transport's two, as the window measures them. */
const SEVEN = [
  slotAt(20, 700),
  slotAt(100, 700),
  slotAt(180, 700),
  slotAt(260, 700),
  slotAt(340, 700),
  slotAt(40, 620),
  slotAt(320, 620),
];

/** A full-screen sheet the window measures [offset] dp above its own top. */
const sheet = (offset: number) => ({ left: 0, top: -offset, right: 412, bottom: 915 - offset });

test("the finger over a slot finds it when the window frame is offset from the sheet's", () => {
  // The window frame sits 24 dp above the gesture's (an edge-to-edge status bar):
  // the sheet measures at -24 and slot 3 at 676, so in the sheet slot 3 starts at 700.
  const shifted = SEVEN.map((slot) => ({ ...slot, top: slot.top - 24, bottom: slot.bottom - 24 }));
  const slots = slotRectsInFrame(sheet(24), shifted);
  assert.equal(slotUnderFinger(slots, 284, 704), 3);
  assert.equal(slotUnderFinger(slots, 284, 744), 3);
});

test("every slot measured in the drag's one pass can take the drop", () => {
  const slots = slotRectsInFrame(sheet(0), SEVEN);
  assert.deepEqual(
    SEVEN.map((slot) => slotUnderFinger(slots, slot.left + 24, slot.top + 24)),
    [0, 1, 2, 3, 4, 5, 6],
  );
});

test("a finger between slots or off the row is over none", () => {
  const slots = slotRectsInFrame(sheet(0), SEVEN);
  assert.equal(slotUnderFinger(slots, 84, 724), -1);
  assert.equal(slotUnderFinger(slots, 284, 400), -1);
});

test("a slot not laid out takes no drop, and neither does any slot of an unmeasured sheet", () => {
  const partly = slotRectsInFrame(sheet(0), [slotAt(20, 700), undefined]);
  assert.deepEqual(partly[1], null);
  assert.equal(slotUnderFinger(partly, 44, 724), 0);
  assert.equal(slotUnderFinger(slotRectsInFrame(undefined, SEVEN), 44, 724), -1);
});
