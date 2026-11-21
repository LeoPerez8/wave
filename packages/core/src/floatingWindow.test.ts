import assert from "node:assert/strict";
import { test } from "node:test";
import {
  floatingWindowPosition,
  readFloatingWindowPosition,
  storedFloatingWindowPosition,
} from "./index.ts";

const size = { width: 340, height: 96 };
const primary = { x: 0, y: 0, width: 1920, height: 1040 };
const right = { x: 1920, y: 0, width: 1280, height: 984 };

test("a window never placed opens in the first screen's bottom right corner", () => {
  assert.deepEqual(floatingWindowPosition(undefined, size, [primary, right]), { x: 1556, y: 920 });
});

test("a window stays where it was left on a screen that is still there", () => {
  assert.deepEqual(floatingWindowPosition({ x: 2400, y: 300 }, size, [primary, right]), {
    x: 2400,
    y: 300,
  });
});

test("a window left across two screens stays across them", () => {
  assert.deepEqual(floatingWindowPosition({ x: 1800, y: 300 }, size, [primary, right]), {
    x: 1800,
    y: 300,
  });
});

test("a window whose screen is gone comes back onto the first screen", () => {
  assert.deepEqual(floatingWindowPosition({ x: 2400, y: 300 }, size, [primary]), {
    x: 1580,
    y: 300,
  });
  assert.deepEqual(floatingWindowPosition({ x: -900, y: -700 }, size, [primary]), { x: 0, y: 0 });
});

test("a window partly off its screen is moved whole onto it", () => {
  assert.deepEqual(floatingWindowPosition({ x: 3100, y: 950 }, size, [primary, right]), {
    x: 2860,
    y: 888,
  });
});

test("a window larger than its screen starts at the screen's corner", () => {
  assert.deepEqual(
    floatingWindowPosition({ x: 50, y: 50 }, size, [{ x: 10, y: 20, width: 300, height: 80 }]),
    { x: 10, y: 20 },
  );
});

test("with no screen known, the window goes where it was left", () => {
  assert.deepEqual(floatingWindowPosition({ x: 5, y: 6 }, size, []), { x: 5, y: 6 });
  assert.deepEqual(floatingWindowPosition(undefined, size, []), { x: 0, y: 0 });
});

test("a stored position is read back, and anything else reads as never placed", () => {
  assert.deepEqual(readFloatingWindowPosition(storedFloatingWindowPosition({ x: -12, y: 40 })), {
    x: -12,
    y: 40,
  });
  for (const stored of [
    undefined,
    null,
    "",
    "{",
    "[1,2]",
    '{"x":1}',
    '{"x":1.5,"y":2}',
    '{"x":"1","y":2}',
  ])
    assert.equal(readFloatingWindowPosition(stored), undefined);
});
