import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { contrastRatio, paletteGradient } from "./index.ts";

// Wave's own tokens (apps/mobile/global.css): the ground, then the text and
// control colours Now Playing sets on the gradient (ink, graphite, teal).
const dark = { scheme: "dark", ground: "#121b1d", ink: ["#e0ecef", "#a5b0b3", "#59c0ad"] } as const;
const light = {
  scheme: "light",
  ground: "#e0ecef",
  ink: ["#121b1d", "#454f52", "#006a5f"],
} as const;

/** Every ink colour reads at WCAG AA (4.5:1) on both stops. */
const readableOn = (gradient: { top: string; bottom: string }, ink: readonly string[]) =>
  ink.every(
    (colour) =>
      contrastRatio(colour, gradient.top) >= 4.5 && contrastRatio(colour, gradient.bottom) >= 4.5,
  );

describe("contrastRatio", () => {
  test("black on white is the WCAG maximum of 21:1", () => {
    assert.equal(contrastRatio("#000000", "#ffffff"), 21);
  });

  test("#767676 on white just passes 4.5:1, the usual reference grey", () => {
    assert.equal(contrastRatio("#767676", "#ffffff").toFixed(2), "4.54");
  });

  test("is the same whichever colour is in front", () => {
    assert.equal(contrastRatio("#ffffff", "#767676"), contrastRatio("#767676", "#ffffff"));
  });
});

describe("paletteGradient", () => {
  test("artwork without a palette leaves the plain ground", () => {
    assert.deepEqual(paletteGradient(null, dark), { top: "#121b1d", bottom: "#121b1d" });
    assert.deepEqual(paletteGradient({}, light), { top: "#e0ecef", bottom: "#e0ecef" });
  });

  // A navy-and-slate cover, as Android Palette reports it.
  const navy = {
    dominant: "#22436a",
    vibrant: "#3a78c4",
    darkVibrant: "#1d3b5a",
    lightVibrant: "#9cc3f0",
    muted: "#5d7189",
    darkMuted: "#2a2f3a",
    lightMuted: "#b8c4d2",
  };

  test("in dark mode it runs from the dark vibrant swatch down to the dark muted one", () => {
    assert.deepEqual(paletteGradient(navy, dark), { top: "#1d3b5a", bottom: "#2a2f3a" });
  });

  test("in light mode, a swatch too dark for the teal controls is lifted toward the ground", () => {
    // The light vibrant blue leaves the teal at about 3.6:1 as it is.
    const gradient = paletteGradient(navy, light);
    assert.ok(readableOn(gradient, light.ink), JSON.stringify(gradient));
    assert.notEqual(gradient.top, light.ground);
  });

  test("a palette of one bright colour fades from a toned version of it into the ground", () => {
    const gradient = paletteGradient({ dominant: "#e74c3c" }, dark);
    assert.ok(readableOn(gradient, dark.ink), JSON.stringify(gradient));
    assert.notEqual(gradient.top, dark.ground);
    assert.equal(gradient.bottom, dark.ground);
  });

  test("a swatch that isn't a #rrggbb colour is skipped", () => {
    const gradient = paletteGradient({ darkVibrant: "blue", darkMuted: "#2a2f3a" }, dark);
    assert.deepEqual(gradient, { top: "#2a2f3a", bottom: "#121b1d" });
  });
});
