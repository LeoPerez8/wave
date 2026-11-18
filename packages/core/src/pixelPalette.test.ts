import assert from "node:assert/strict";
import { test } from "node:test";

import { pixelPalette } from "./index.ts";

/** RGBA pixels: each [colour, count] repeated, fully opaque unless an alpha is given. */
const pixels = (...runs: readonly (readonly [string, number, number?])[]): Uint8ClampedArray => {
  const out: number[] = [];
  for (const [hex, count, alpha = 255] of runs) {
    const value = Number.parseInt(hex.slice(1), 16);
    for (let i = 0; i < count; i++)
      out.push((value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff, alpha);
  }
  return Uint8ClampedArray.from(out);
};

test("the dominant swatch is the most common colour", () => {
  const palette = pixelPalette(pixels(["#204060", 300], ["#e03020", 100]));
  assert.equal(palette.dominant, "#204060");
});

test("a saturated mid-light colour is the vibrant swatch, a dark one the dark vibrant", () => {
  const palette = pixelPalette(pixels(["#e03020", 200], ["#102a80", 200], ["#808080", 50]));
  assert.equal(palette.vibrant, "#e03020");
  assert.equal(palette.darkVibrant, "#102a80");
});

test("greyish colours make the muted swatches", () => {
  const palette = pixelPalette(pixels(["#7a8a80", 200], ["#c8d0cc", 200], ["#303a34", 200]));
  assert.equal(palette.muted, "#7a8a80");
  assert.equal(palette.lightMuted, "#c8d0cc");
  assert.equal(palette.darkMuted, "#303a34");
  assert.equal(palette.vibrant, undefined);
});

test("near-black, near-white and transparent pixels don't count", () => {
  const palette = pixelPalette(
    pixels(["#000000", 500], ["#ffffff", 500], ["#e03020", 500, 0], ["#2060c0", 10]),
  );
  assert.equal(palette.dominant, "#2060c0");
  assert.equal(palette.lightVibrant, undefined);
});

test("artwork with nothing to pick has an empty palette", () => {
  assert.deepEqual(pixelPalette(pixels(["#000000", 100])), {});
  assert.deepEqual(pixelPalette(new Uint8ClampedArray()), {});
});
