/// <reference types="node" />
// The playing-song underline is drawn natively (`wave_underline.xml`, an
// AnimatedVectorDrawable, issue #93), so its shape and ripple can't import
// Core. This fails when the drawable drifts from Core's `UNDERLINE_WAVE` and
// `wavePath`, the single source the scrubber's wave also scales from.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { UNDERLINE_WAVE, wavePath } from "@wave/core";

const xml = readFileSync(
  new URL(
    "../../modules/wave-glass/android/src/main/res/drawable/wave_underline.xml",
    import.meta.url,
  ),
  "utf8",
);

/** The value of `android:<name>` on the first element that has it. */
const attribute = (name: string): string => {
  const match = new RegExp(`android:${name}="([^"]*)"`).exec(xml);
  assert.ok(match, `wave_underline.xml has android:${name}`);
  return match[1]!;
};

describe("wave_underline.xml", () => {
  const { wavelength, amplitude, stroke, rippleMs } = UNDERLINE_WAVE;
  const tile = Number(attribute("viewportWidth"));

  test("takes 1.05 seconds to ripple one wavelength", () => {
    assert.equal(Number(attribute("duration")), 1050);
  });

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
