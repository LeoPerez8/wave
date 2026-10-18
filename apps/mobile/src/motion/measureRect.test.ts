/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { measurePressed, type Measurable } from "./measureRect.ts";

/** A laid-out view at [x], [y], [width] by [height] in the window. */
const viewAt = (x: number, y: number, width: number, height: number): Measurable => ({
  measureInWindow: (callback) => callback(x, y, width, height),
});

describe("measurePressed", () => {
  test("a press highlights itself at rest, grown back from its press feedback, with the row's corners", async () => {
    // Sunk to 90% about its centre (200, 100): 180 by 36 measured, 200 by 40 at rest.
    const segment = viewAt(110, 82, 180, 36);
    assert.deepEqual(await measurePressed(segment, { scale: 0.9 }), {
      rect: { left: 100, top: 80, right: 300, bottom: 120 },
      radius: undefined,
    });
  });

  test("a press with a highlight view highlights that view, with its radius", async () => {
    const segment = viewAt(110, 82, 80, 36);
    // The toggle's drawn pill: 160 by 32, which doesn't sink with the segment.
    const pill = viewAt(100, 90, 160, 32);
    assert.deepEqual(
      await measurePressed(segment, { scale: 0.9, highlight: { view: pill, radius: 16 } }),
      { rect: { left: 100, top: 90, right: 260, bottom: 122 }, radius: 16 },
    );
  });

  test("nothing laid out measures nothing", async () => {
    assert.deepEqual(await measurePressed(null, { scale: 1 }), {
      rect: undefined,
      radius: undefined,
    });
  });
});
