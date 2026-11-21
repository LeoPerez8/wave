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
  writeGlassSettings,
} from "./index.ts";

/** Wave's glass before it could be tuned: 24 dp blur, 12 dp refraction, tint alpha B8, full rim. */
const TODAY = { blur: 24, refraction: 12, tint: 72, rim: 100 };

describe("readGlassSettings", () => {
  test("a fresh install (nothing stored) looks exactly as the glass did before Settings", () => {
    assert.deepEqual(readGlassSettings(null), TODAY);
    assert.equal(glassTintAlpha(readGlassSettings(null).tint), "B8");
  });

  test("stored values come back", () => {
    const stored = JSON.stringify({ blur: 36, refraction: 0, tint: 86, rim: true, rimLevel: 50 });
    assert.deepEqual(readGlassSettings(stored), { blur: 36, refraction: 0, tint: 86, rim: 50 });
  });

  test("missing, mistyped or unreadable values fall back to their defaults one by one", () => {
    assert.deepEqual(readGlassSettings(JSON.stringify({ blur: 48 })), { ...TODAY, blur: 48 });
    assert.deepEqual(readGlassSettings(JSON.stringify({ tint: "lots", rim: "lots" })), TODAY);
    assert.deepEqual(readGlassSettings(JSON.stringify({ rim: 50, rimLevel: "lots" })), TODAY);
    assert.deepEqual(readGlassSettings("{not json"), TODAY);
    assert.deepEqual(readGlassSettings("[1,2]"), TODAY);
  });

  test("values out of range land on the end level, so the glass never becomes unreadable", () => {
    const stored = JSON.stringify({ blur: 0, refraction: 500, tint: 0 });
    assert.deepEqual(readGlassSettings(stored), { blur: 8, refraction: 24, tint: 50, rim: 100 });
  });

  test("a value stored or synced before the levels reads as the nearest level", () => {
    const stored = JSON.stringify({ blur: 30.5, refraction: 4, tint: 90 });
    assert.deepEqual(readGlassSettings(stored), { blur: 36, refraction: 6, tint: 86, rim: 100 });
    assert.deepEqual(readGlassSettings(JSON.stringify({ blur: 20, refraction: 16, tint: 55 })), {
      blur: 16,
      refraction: 18,
      tint: 50,
      rim: 100,
    });
  });

  test("a value halfway between two levels reads as the lower one", () => {
    const stored = JSON.stringify({ blur: 30, refraction: 3, tint: 93 });
    assert.deepEqual(readGlassSettings(stored), { blur: 24, refraction: 0, tint: 86, rim: 100 });
  });

  test("the switch an older build stores reads as the shipped rim or as off", () => {
    assert.deepEqual(readGlassSettings(JSON.stringify({ rim: true })), TODAY);
    assert.deepEqual(readGlassSettings(JSON.stringify({ rim: false })), { ...TODAY, rim: 0 });
  });

  test("stored rim levels land on their nearest level", () => {
    const rimOf = (rimLevel: number) => readGlassSettings(JSON.stringify({ rim: true, rimLevel }));
    assert.deepEqual(rimOf(74), { ...TODAY, rim: 50 });
    assert.deepEqual(rimOf(75), { ...TODAY, rim: 50 });
    assert.deepEqual(rimOf(76), { ...TODAY, rim: 100 });
    assert.deepEqual(rimOf(900), { ...TODAY, rim: 200 });
  });

  test("the rim level is read without the switch beside it", () => {
    assert.deepEqual(readGlassSettings(JSON.stringify({ rimLevel: 150 })), { ...TODAY, rim: 150 });
    assert.deepEqual(readGlassSettings(JSON.stringify({ rimLevel: 0 })), { ...TODAY, rim: 0 });
  });

  test("a switch that contradicts the level is an older build's later write, so it wins", () => {
    const off = JSON.stringify({ rim: false, rimLevel: 150 });
    assert.deepEqual(readGlassSettings(off), { ...TODAY, rim: 0 });
    const on = JSON.stringify({ rim: true, rimLevel: 0 });
    assert.deepEqual(readGlassSettings(on), { ...TODAY, rim: 100 });
  });

  test("a switch that agrees with the level leaves the level alone", () => {
    const stored = JSON.stringify({ rim: true, rimLevel: 200 });
    assert.deepEqual(readGlassSettings(stored), { ...TODAY, rim: 200 });
    const none = JSON.stringify({ rim: false, rimLevel: 0 });
    assert.deepEqual(readGlassSettings(none), { ...TODAY, rim: 0 });
  });
});

describe("writeGlassSettings", () => {
  test("the rim level is stored beside the switch older builds read", () => {
    assert.deepEqual(JSON.parse(writeGlassSettings({ ...TODAY, blur: 36, rim: 150 })), {
      blur: 36,
      refraction: 12,
      tint: 72,
      rim: true,
      rimLevel: 150,
    });
    const off = JSON.parse(writeGlassSettings({ ...TODAY, rim: 0 }));
    assert.equal(off.rim, false);
    assert.equal(off.rimLevel, 0);
    assert.equal(JSON.parse(writeGlassSettings({ ...TODAY, rim: 50 })).rim, true);
  });

  test("what is written reads back as it was", () => {
    for (const rim of GLASS_SETTINGS.rim.levels) {
      const glass = { blur: 48, refraction: 0, tint: 61, rim };
      assert.deepEqual(readGlassSettings(writeGlassSettings(glass)), glass);
    }
  });

  test("values off the levels are written as their nearest level", () => {
    const written = writeGlassSettings({ blur: 30.5, refraction: 4, tint: 90, rim: 74 });
    assert.deepEqual(readGlassSettings(written), { blur: 36, refraction: 6, tint: 86, rim: 50 });
    assert.equal(JSON.parse(written).rimLevel, 50);
  });

  test("an older build's rewrite keeps the rim on or off, at the shipped strength", () => {
    // An older build reads any switch but `false` as on, and writes back only what it knows.
    const { rim } = JSON.parse(writeGlassSettings({ ...TODAY, rim: 150 }));
    const rewritten = JSON.stringify({ blur: 16, refraction: 12, tint: 72, rim: rim !== false });
    assert.deepEqual(readGlassSettings(rewritten), { ...TODAY, blur: 16, rim: 100 });
  });
});

describe("GLASS_SETTINGS", () => {
  test("every glass control has five levels, the middle one the glass as shipped", () => {
    assert.deepEqual(GLASS_SETTINGS.blur.levels, [8, 16, 24, 36, 48]);
    assert.deepEqual(GLASS_SETTINGS.refraction.levels, [0, 6, 12, 18, 24]);
    assert.deepEqual(GLASS_SETTINGS.tint.levels, [50, 61, 72, 86, 100]);
    assert.deepEqual(GLASS_SETTINGS.rim.levels, [0, 50, 100, 150, 200]);
    for (const setting of ["blur", "refraction", "tint", "rim"] as const) {
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
    assert.deepEqual(
      [1, 2, 3, 4, 5].map((level) => glassLevelValue("rim", level)),
      [0, 50, 100, 150, 200],
    );
    assert.equal(glassLevel("blur", 36), 4);
    assert.equal(glassLevel("refraction", 0), 1);
    assert.equal(glassLevel("tint", 100), 5);
    assert.equal(glassLevel("rim", 150), 4);
  });

  test("a value off the levels is at the nearest level", () => {
    assert.equal(glassLevel("blur", 33), 4);
    assert.equal(glassLevel("blur", 2), 1);
    assert.equal(glassLevel("tint", 1000), 5);
    assert.equal(glassLevel("refraction", Number.NaN), DEFAULT_GLASS_LEVEL);
    assert.equal(glassLevel("rim", 175), 4);
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
    assert.equal(isDefaultGlassSettings({ blur: 24, refraction: 12, tint: 72, rim: 100 }), true);
    assert.equal(isDefaultGlassSettings({ blur: 24, refraction: 12, tint: 72, rim: 0 }), false);
    assert.equal(isDefaultGlassSettings({ blur: 36, refraction: 12, tint: 72, rim: 100 }), false);
  });
});
