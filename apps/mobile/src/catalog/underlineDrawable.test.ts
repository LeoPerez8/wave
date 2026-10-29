/// <reference types="node" />
// The playing-song underline is drawn natively (`wave_underline.xml`, an
// AnimatedVectorDrawable, issue #93), so its shape and ripple can't import
// Core. This fails when the drawable drifts from Core's `UNDERLINE_WAVE` and
// `wavePath`, the single source the scrubber's wave also scales from. The
// Recognize card's `wave_listening.xml` is checked against `LISTENING_WAVE` the same way.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { LISTENING_WAVE, UNDERLINE_WAVE, wavePath } from "@wave/core";

const drawables = [
  ["wave_underline.xml", UNDERLINE_WAVE],
  // The Recognize card's listening wave is the same line, larger and slower.
  ["wave_listening.xml", LISTENING_WAVE],
] as const;

for (const [name, wave] of drawables) {
  const xml = readFileSync(
    new URL(`../../modules/wave-glass/android/src/main/res/drawable/${name}`, import.meta.url),
    "utf8",
  );

  /** The value of `android:<key>` on the first element that has it. */
  const attribute = (key: string): string => {
    const match = new RegExp(`android:${key}="([^"]*)"`).exec(xml);
    assert.ok(match, `${name} has android:${key}`);
    return match[1]!;
  };

  describe(name, () => {
    const { wavelength, amplitude, stroke, rippleMs } = wave;
    const tile = Number(attribute("viewportWidth"));

    test("draws Core's wave across its tile, one wavelength past it", () => {
      assert.equal(attribute("pathData"), wavePath({ width: tile, wavelength, amplitude }));
      assert.equal(Number(attribute("strokeWidth")), stroke);
    });

    test("is tall enough for crest, trough and stroke, with the centre line in the middle", () => {
      assert.equal(Number(attribute("viewportHeight")), amplitude * 2 + stroke);
      assert.equal(attribute("height"), `${amplitude * 2 + stroke}dp`);
      assert.equal(Number(attribute("translateY")), stroke / 2);
    });

    test("ripples by sliding one wavelength left per period, forever", () => {
      assert.equal(tile % wavelength, 0, "tiles meet without a seam");
      assert.equal(Number(attribute("valueFrom")), 0);
      assert.equal(Number(attribute("valueTo")), -wavelength);
      assert.equal(Number(attribute("duration")), rippleMs);
    });
  });
}

test("the underline takes 1.05 seconds to ripple one wavelength", () => {
  assert.equal(UNDERLINE_WAVE.rippleMs, 1050);
});
