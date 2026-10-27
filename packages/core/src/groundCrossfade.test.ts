import assert from "node:assert/strict";
import { test } from "node:test";

import { crossfadeGround } from "./index.ts";

const red = { top: "#ff0000", bottom: "#800000" };
const blue = { top: "#0000ff", bottom: "#000080" };
const green = { top: "#00ff00", bottom: "#008000" };

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
  // Half of blue over red shows #800080 on top and #400040 at the bottom.
  assert.deepEqual(crossfadeGround({ base: red, incoming: blue }, green, 0.5, false), {
    base: { top: "#800080", bottom: "#400040" },
    incoming: green,
  });
  // A fade that just started still shows the old colours.
  assert.deepEqual(crossfadeGround({ base: red, incoming: blue }, green, 0, false), {
    base: red,
    incoming: green,
  });
});

test("out of sight or with reduced motion the new colours show at once", () => {
  assert.deepEqual(crossfadeGround({ base: red, incoming: blue }, green, 0.5, true), {
    base: green,
    incoming: null,
  });
});
