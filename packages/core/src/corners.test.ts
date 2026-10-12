import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { concentricRadius } from "./index.ts";

describe("concentricRadius", () => {
  test("an inner corner inset evenly is the outer radius minus the inset", () => {
    // A 20-radius card holding a 64 dp square 6 dp in from its edges.
    assert.equal(concentricRadius({ outerRadius: 20, insetX: 6, insetY: 6, size: 64 }), 14);
  });

  test("with uneven insets the corner follows the farther edge, so it never crowds the curve", () => {
    // The mini player: a 56 dp pill (radius 28), 40 dp artwork 12 dp in from the side.
    assert.equal(concentricRadius({ outerRadius: 28, insetX: 12, insetY: 8, size: 40 }), 16);
    assert.equal(concentricRadius({ outerRadius: 28, insetX: 8, insetY: 12, size: 40 }), 16);
  });

  test("a square inset deeper than the outer radius keeps square corners", () => {
    assert.equal(concentricRadius({ outerRadius: 10, insetX: 16, insetY: 16, size: 40 }), 0);
  });

  test("a small square in a very round shape rounds no further than a circle", () => {
    assert.equal(concentricRadius({ outerRadius: 40, insetX: 4, insetY: 4, size: 24 }), 12);
  });
});
