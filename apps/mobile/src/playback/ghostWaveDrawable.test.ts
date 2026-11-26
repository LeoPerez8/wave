/// <reference types="node" />
// The mini player's ghost wave is drawn natively (`wave_ghost_offline.xml`,
// `wave_ghost_slow.xml`, AnimatedVectorDrawables, so the glass isn't
// re-blurred: #93), so its shape and timing can't import Core. This fails when
// a drawable drifts from Core's `MINI_GHOST_WAVE`, `miniGhostWavePath` and the
// ghost wave's periods.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { GHOST_WAVE, MINI_GHOST_WAVE, miniGhostWavePath } from "@wave/core";

const drawables = [
  ["wave_ghost_offline.xml", GHOST_WAVE.offlinePeriodMs],
  ["wave_ghost_slow.xml", GHOST_WAVE.slowPeriodMs],
] as const;

for (const [name, periodMs] of drawables) {
  const xml = readFileSync(
    new URL(`../../modules/wave-glass/android/src/main/res/drawable/${name}`, import.meta.url),
    "utf8",
  );
  /** Every value of `android:<key>`, in order. */
  const values = (key: string): string[] =>
    [...xml.matchAll(new RegExp(`android:${key}="([^"]*)"`, "g"))].map((m) => m[1]!);

  describe(name, () => {
    const { length, stroke, amplitude, opacity, travel } = MINI_GHOST_WAVE;

    test("draws Core's segment, in a box tall enough for crest, trough and stroke", () => {
      assert.deepEqual(values("pathData"), [miniGhostWavePath()]);
      assert.deepEqual(values("strokeWidth"), [String(stroke)]);
      assert.deepEqual(values("viewportHeight"), [String(amplitude * 2 + stroke)]);
      assert.deepEqual(values("translateY"), [String(stroke / 2)]);
    });

    test("sweeps from just left of the pill past its widest end, fading from 70% to nothing", () => {
      assert.deepEqual(values("viewportWidth"), [String(travel)]);
      assert.deepEqual(values("valueFrom"), [String(-length), String(opacity)]);
      assert.deepEqual(values("valueTo"), [String(travel), "0"]);
      assert.deepEqual(values("strokeAlpha"), [String(opacity)]);
    });

    test("runs on Now Playing's period, forever", () => {
      assert.deepEqual(values("duration"), [String(periodMs), String(periodMs)]);
      assert.deepEqual(values("repeatCount"), ["infinite", "infinite"]);
    });
  });
}
