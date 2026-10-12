import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { LONG_PRESS_DELAY, readLongPressDelay, snapLongPressDelay } from "./index.ts";

describe("long-press delay", () => {
  test("runs from 50 to 500 ms and defaults to Android's 500 ms", () => {
    assert.equal(LONG_PRESS_DELAY.min, 50);
    assert.equal(LONG_PRESS_DELAY.max, 500);
    assert.equal(LONG_PRESS_DELAY.default, 500);
  });

  test("a chosen value snaps to the nearest 10 ms", () => {
    assert.equal(snapLongPressDelay(243), 240);
    assert.equal(snapLongPressDelay(246), 250);
  });

  test("a value outside the range is clamped into it", () => {
    assert.equal(snapLongPressDelay(10), 50);
    assert.equal(snapLongPressDelay(0), 50);
    assert.equal(snapLongPressDelay(2000), 500);
  });

  test("nothing stored keeps today's 500 ms", () => {
    assert.equal(readLongPressDelay(null), 500);
  });

  test("a stored value is read back, clamped and snapped", () => {
    assert.equal(readLongPressDelay("200"), 200);
    assert.equal(readLongPressDelay("20"), 50);
    assert.equal(readLongPressDelay("9000"), 500);
    assert.equal(readLongPressDelay("317"), 320);
  });

  test("a stored value that isn't a number falls back to the default", () => {
    assert.equal(readLongPressDelay("soon"), 500);
    assert.equal(readLongPressDelay(""), 500);
  });
});
