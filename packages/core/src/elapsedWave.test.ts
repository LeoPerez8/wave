import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { elapsedWavePath } from "./index.ts";

describe("elapsedWavePath", () => {
  test("at 0:00 there is no wave: the line is entirely flat", () => {
    assert.equal(elapsedWavePath({ length: 0, wavelength: 8, amplitude: 2 }), "");
  });

  test("a playhead on a whole number of half-waves draws the underline's wave up to it, ending on the centre line", () => {
    // Same shape as wavePath: centre at y = amplitude, crest first.
    assert.equal(elapsedWavePath({ length: 8, wavelength: 8, amplitude: 2 }), "M0 2Q2 -2 4 2T8 2");
  });

  test("between half-waves, the last one is a smaller copy that lands on the centre line exactly at the playhead", () => {
    // Third half-wave (a crest), half grown: half as wide and half as tall.
    assert.equal(
      elapsedWavePath({ length: 10, wavelength: 8, amplitude: 2 }),
      "M0 2Q2 -2 4 2T8 2Q9 0 10 2",
    );
  });

  test("a growing trough bends down, continuing the wave's alternation", () => {
    assert.equal(
      elapsedWavePath({ length: 6, wavelength: 8, amplitude: 2 }),
      "M0 2Q2 -2 4 2Q5 4 6 2",
    );
  });

  test("a playhead short of the first half-wave draws just that small crest", () => {
    assert.equal(elapsedWavePath({ length: 1, wavelength: 8, amplitude: 2 }), "M0 2Q0.5 1 1 2");
  });

  test("earlier half-waves stay put as the playhead moves on: the wave is still", () => {
    for (const length of [13, 15]) {
      assert.ok(
        elapsedWavePath({ length, wavelength: 8, amplitude: 2 }).startsWith(
          "M0 2Q2 -2 4 2T8 2T12 2",
        ),
      );
    }
  });
});
