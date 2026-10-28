import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DEFAULT_GLASS_LEVEL,
  GLASS_LEVEL_RANGE,
  GLASS_SETTINGS,
  glassLevel,
  glassLevelValue,
  glassTintAlpha,
  isDefaultGlassSettings,
  readGlassSettings,
  sliderValueAt,
  stepSlider,
} from "./index.ts";

/** Wave's glass before it could be tuned: 24 dp blur, 12 dp refraction, tint alpha B8, rim on. */
const TODAY = { blur: 24, refraction: 12, tint: 72, rim: true };

describe("readGlassSettings", () => {
  test("a fresh install (nothing stored) looks exactly as the glass did before Settings", () => {
    assert.deepEqual(readGlassSettings(null), TODAY);
    assert.equal(glassTintAlpha(readGlassSettings(null).tint), "B8");
  });

  test("stored values come back", () => {
    const stored = JSON.stringify({ blur: 36, refraction: 0, tint: 86, rim: false });
    assert.deepEqual(readGlassSettings(stored), { blur: 36, refraction: 0, tint: 86, rim: false });
  });

  test("missing, mistyped or unreadable values fall back to their defaults one by one", () => {
    assert.deepEqual(readGlassSettings(JSON.stringify({ blur: 48 })), { ...TODAY, blur: 48 });
    assert.deepEqual(readGlassSettings(JSON.stringify({ tint: "lots", rim: 1 })), TODAY);
    assert.deepEqual(readGlassSettings("{not json"), TODAY);
    assert.deepEqual(readGlassSettings("[1,2]"), TODAY);
  });

  test("values out of range land on the end level, so the glass never becomes unreadable", () => {
    const stored = JSON.stringify({ blur: 0, refraction: 500, tint: 0 });
    assert.deepEqual(readGlassSettings(stored), { blur: 8, refraction: 24, tint: 50, rim: true });
  });

  test("a value stored or synced before the levels reads as the nearest level", () => {
    const stored = JSON.stringify({ blur: 30.5, refraction: 4, tint: 90 });
    assert.deepEqual(readGlassSettings(stored), { blur: 36, refraction: 6, tint: 86, rim: true });
    assert.deepEqual(readGlassSettings(JSON.stringify({ blur: 20, refraction: 16, tint: 55 })), {
      blur: 16,
      refraction: 18,
      tint: 50,
      rim: true,
    });
  });

  test("a value halfway between two levels reads as the lower one", () => {
    const stored = JSON.stringify({ blur: 30, refraction: 3, tint: 93 });
    assert.deepEqual(readGlassSettings(stored), { blur: 24, refraction: 0, tint: 86, rim: true });
  });
});

describe("GLASS_SETTINGS", () => {
  test("Blur, Refraction and Tint each have five levels, the middle one the glass as shipped", () => {
    assert.deepEqual(GLASS_SETTINGS.blur.levels, [8, 16, 24, 36, 48]);
    assert.deepEqual(GLASS_SETTINGS.refraction.levels, [0, 6, 12, 18, 24]);
    assert.deepEqual(GLASS_SETTINGS.tint.levels, [50, 61, 72, 86, 100]);
    for (const setting of ["blur", "refraction", "tint"] as const) {
      assert.equal(GLASS_SETTINGS[setting].levels[DEFAULT_GLASS_LEVEL - 1], TODAY[setting]);
    }
  });

  test("tint can't go below half, so text stays legible over busy artwork", () => {
    assert.ok(GLASS_SETTINGS.tint.levels.every((tint) => tint >= 50));
    assert.equal(GLASS_SETTINGS.tint.levels.at(-1), 100);
  });

  test("blur never reaches 0; refraction's first level is off (blur, tint and rim only)", () => {
    assert.ok(GLASS_SETTINGS.blur.levels.every((blur) => blur > 0));
    assert.equal(GLASS_SETTINGS.refraction.levels[0], 0);
  });
});

describe("glass levels on the Settings slider", () => {
  test("the slider runs over the five levels, one step each", () => {
    assert.deepEqual(GLASS_LEVEL_RANGE, { min: 1, max: 5, step: 1 });
    assert.equal(DEFAULT_GLASS_LEVEL, 3);
    const landed = new Set<number>();
    for (let x = 0; x <= 300; x += 1) landed.add(sliderValueAt(x, 300, GLASS_LEVEL_RANGE));
    assert.deepEqual([...landed], [1, 2, 3, 4, 5]);
  });

  test("each level holds its value, and each value its level", () => {
    assert.deepEqual(
      [1, 2, 3, 4, 5].map((level) => glassLevelValue("blur", level)),
      [8, 16, 24, 36, 48],
    );
    assert.equal(glassLevelValue("refraction", 1), 0);
    assert.equal(glassLevelValue("tint", 4), 86);
    assert.equal(glassLevel("blur", 36), 4);
    assert.equal(glassLevel("refraction", 0), 1);
    assert.equal(glassLevel("tint", 100), 5);
  });

  test("a value off the levels is at the nearest level", () => {
    assert.equal(glassLevel("blur", 33), 4);
    assert.equal(glassLevel("blur", 2), 1);
    assert.equal(glassLevel("tint", 1000), 5);
    assert.equal(glassLevel("refraction", Number.NaN), DEFAULT_GLASS_LEVEL);
  });

  test("a level off the slider is held to its ends", () => {
    assert.equal(glassLevelValue("blur", 0), 8);
    assert.equal(glassLevelValue("blur", 9), 48);
    assert.equal(glassLevelValue("tint", 2.4), 61);
  });

  test("a screen reader steps one level at a time", () => {
    const up = stepSlider(glassLevel("blur", 24), 1, GLASS_LEVEL_RANGE);
    assert.equal(glassLevelValue("blur", up), 36);
    const down = stepSlider(glassLevel("refraction", 6), -1, GLASS_LEVEL_RANGE);
    assert.equal(glassLevelValue("refraction", down), 0);
  });
});

describe("glassTintAlpha", () => {
  test("a tint percentage as the hex alpha laid over the surface colour", () => {
    assert.equal(glassTintAlpha(100), "FF");
    assert.equal(glassTintAlpha(50), "80");
    assert.equal(glassTintAlpha(72), "B8");
    assert.equal(glassTintAlpha(5), "0D");
  });
});

describe("isDefaultGlassSettings", () => {
  test("only the glass as shipped is the default, so Reset is off until a setting moves", () => {
    assert.equal(isDefaultGlassSettings(readGlassSettings(null)), true);
    assert.equal(isDefaultGlassSettings({ blur: 24, refraction: 12, tint: 72, rim: true }), true);
    assert.equal(isDefaultGlassSettings({ blur: 24, refraction: 12, tint: 72, rim: false }), false);
    assert.equal(isDefaultGlassSettings({ blur: 36, refraction: 12, tint: 72, rim: true }), false);
  });
});
