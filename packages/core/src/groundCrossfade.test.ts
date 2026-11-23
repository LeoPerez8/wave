import assert from "node:assert/strict";
import { test } from "node:test";

import { crossfadeGround, sameGround } from "./index.ts";

/** A ground of [colours] spread evenly from top to foot. */
const ground = (...colours: string[]) =>
  colours.map((color, i) => ({ color, at: i / (colours.length - 1) }));

const red = ground("#ff0000", "#800000", "#000000");
const blue = ground("#0000ff", "#000080", "#000000");
const green = ground("#00ff00", "#008000", "#000000");

test("a change over a settled ground fades the new colours in over the old ones", () => {
  assert.deepEqual(crossfadeGround({ base: red, incoming: null }, blue, 1, false), {
    base: red,
    incoming: blue,
  });
});

test("a change after a finished fade keeps the colours the fade reached as the base", () => {
  assert.deepEqual(crossfadeGround({ base: red, incoming: blue }, green, 1, false), {
    base: blue,
    incoming: green,
  });
});

test("a change mid-fade starts from the colours on screen: the two layers blended where they are", () => {
  // Half of blue over red shows #800080 on top and #400040 halfway down.
  assert.deepEqual(crossfadeGround({ base: red, incoming: blue }, green, 0.5, false), {
    base: ground("#800080", "#400040", "#000000"),
    incoming: green,
  });
  // A fade that just started still shows the old colours.
  assert.deepEqual(crossfadeGround({ base: red, incoming: blue }, green, 0, false), {
    base: red,
    incoming: green,
  });
});

test("mid-fade between grounds with different stops, the blend keeps every stop of both", () => {
  const twoStops = ground("#ff0000", "#000000");
  const { base } = crossfadeGround({ base: twoStops, incoming: blue }, green, 0.5, false);
  // Red's middle is #800000 between its stops; blue's is #000080.
  assert.deepEqual(base, ground("#800080", "#400040", "#000000"));
});

test("out of sight or with reduced motion the new colours show at once", () => {
  assert.deepEqual(crossfadeGround({ base: red, incoming: blue }, green, 0.5, true), {
    base: green,
    incoming: null,
  });
});

test("two grounds are the same when they draw the same colours at the same stops", () => {
  assert.ok(sameGround(red, ground("#FF0000", "#800000", "#000000")));
  assert.ok(!sameGround(red, blue));
  assert.ok(!sameGround(red, ground("#ff0000", "#000000")));
});
