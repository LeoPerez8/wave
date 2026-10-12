import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { GLASS_SETTINGS, glassTintAlpha, readGlassSettings } from "./index.ts";

/** Wave's glass before it could be tuned: 24 dp blur, 12 dp refraction, tint alpha B8, rim on. */
const TODAY = { blur: 24, refraction: 12, tint: 72, rim: true };

describe("readGlassSettings", () => {
  test("a fresh install (nothing stored) looks exactly as the glass did before Settings", () => {
    assert.deepEqual(readGlassSettings(null), TODAY);
    assert.equal(glassTintAlpha(readGlassSettings(null).tint), "B8");
  });

  test("stored values come back", () => {
    const stored = JSON.stringify({ blur: 30, refraction: 0, tint: 90, rim: false });
    assert.deepEqual(readGlassSettings(stored), { blur: 30, refraction: 0, tint: 90, rim: false });
  });

  test("missing, mistyped or unreadable values fall back to their defaults one by one", () => {
    assert.deepEqual(readGlassSettings(JSON.stringify({ blur: 30 })), { ...TODAY, blur: 30 });
    assert.deepEqual(readGlassSettings(JSON.stringify({ tint: "lots", rim: 1 })), TODAY);
    assert.deepEqual(readGlassSettings("{not json"), TODAY);
    assert.deepEqual(readGlassSettings("[1,2]"), TODAY);
  });

  test("values out of range are held inside it, so the glass never becomes unreadable", () => {
    const stored = JSON.stringify({ blur: 0, refraction: 500, tint: 0 });
    assert.deepEqual(readGlassSettings(stored), {
      blur: GLASS_SETTINGS.blur.min,
      refraction: GLASS_SETTINGS.refraction.max,
      tint: GLASS_SETTINGS.tint.min,
      rim: true,
    });
  });
});

describe("GLASS_SETTINGS", () => {
  test("tint can't go below half, so text stays legible over busy artwork", () => {
    assert.ok(GLASS_SETTINGS.tint.min >= 50);
    assert.equal(GLASS_SETTINGS.tint.max, 100);
  });

  test("blur never reaches 0; refraction can (blur, tint and rim only)", () => {
    assert.ok(GLASS_SETTINGS.blur.min > 0);
    assert.equal(GLASS_SETTINGS.refraction.min, 0);
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
