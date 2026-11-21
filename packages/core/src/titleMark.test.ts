import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DEFAULT_THEME_CHOICE,
  LOGO_WAVES,
  THEME_SWATCHES,
  chooseCustomInk,
  contrastRatio,
  themeFor,
  titleMarkColours,
  titleMarkFontScale,
  titleMarkLayout,
  type ThemeChoice,
} from "./index.ts";

const custom = (primary: string, secondary: string): ThemeChoice =>
  chooseCustomInk(
    chooseCustomInk(DEFAULT_THEME_CHOICE, "primary", primary),
    "secondary",
    secondary,
  );

describe("titleMarkColours", () => {
  test("the default theme's waves are white in dark and the text colour in light", () => {
    assert.deepEqual(titleMarkColours(DEFAULT_THEME_CHOICE, "dark"), {
      top: "#ffffff",
      bottom: "#ffffff",
    });
    assert.deepEqual(titleMarkColours(DEFAULT_THEME_CHOICE, "light"), {
      top: "#121b1d",
      bottom: "#121b1d",
    });
  });

  test("the top wave takes the primary and the bottom one the secondary", () => {
    // Teal and ember already read on black, so dark mode shows them as chosen.
    assert.deepEqual(titleMarkColours(custom("#59c0ad", "#ec9d53"), "dark"), {
      top: "#59c0ad",
      bottom: "#ec9d53",
    });
  });

  test("each wave is the colour the app shows for that choice in that mode", () => {
    const choice = custom("#59c0ad", "#ec9d53");
    for (const scheme of ["light", "dark"] as const) {
      const colours = themeFor(choice)[scheme];
      assert.deepEqual(titleMarkColours(choice, scheme), {
        top: colours.accent,
        bottom: colours.highlight,
      });
    }
  });

  test("both waves read on every ground, in light and dark, whatever the colours", () => {
    const inks = ["#ffffff", "#000000", "#ffee00", "#2b00ff", "#ff008b", "#e0ecef"];
    for (const light of THEME_SWATCHES.light)
      for (const dark of THEME_SWATCHES.dark)
        for (const primary of inks)
          for (const secondary of inks) {
            const choice = { ...custom(primary, secondary), light: light.id, dark: dark.id };
            for (const scheme of ["light", "dark"] as const) {
              const ground = scheme === "light" ? light.colour : dark.colour;
              const { top, bottom } = titleMarkColours(choice, scheme);
              for (const wave of [top, bottom])
                assert.ok(
                  contrastRatio(wave, ground) >= 3,
                  `${wave} on ${ground} (${primary}, ${secondary}, ${scheme})`,
                );
            }
          }
  });
});

describe("titleMarkLayout", () => {
  test("the waves stand as tall as the large title's capitals, on its baseline", () => {
    // Inter's capitals are 1490 of 2048 units tall: 26.19dp at the large title's 36dp.
    const layout = titleMarkLayout({ fontSize: 36, lineHeight: 44 });
    assert.ok(Math.abs(layout.height - 26.19) < 0.01);
    // The logo is 2.2 units wide and 1.06 tall, round caps included.
    assert.ok(Math.abs(layout.width - 54.36) < 0.01);
    // Inter descends 8.68dp below the baseline at 36dp, and its 43.56dp line box is centred in 44dp.
    assert.ok(Math.abs(layout.baseline - 8.9) < 0.01);
    // One 8dp cell between the waves and the word.
    assert.ok(Math.abs(layout.gap - 8) < 1e-9);
  });

  test("the waves grow with the font size", () => {
    const base = titleMarkLayout({ fontSize: 36, lineHeight: 44 });
    const doubled = titleMarkLayout({ fontSize: 72, lineHeight: 88 });
    assert.ok(Math.abs(doubled.height - 2 * base.height) < 1e-9);
    assert.ok(Math.abs(doubled.width - 2 * base.width) < 1e-9);
    assert.ok(Math.abs(doubled.baseline - 2 * base.baseline) < 1e-9);
    assert.ok(Math.abs(doubled.gap - 2 * base.gap) < 1e-9);
  });

  test("the stroke keeps the logo's proportions", () => {
    const { width, stroke } = titleMarkLayout({ fontSize: 36, lineHeight: 44 });
    assert.ok(Math.abs(stroke / width - LOGO_WAVES.stroke / (2 + LOGO_WAVES.stroke)) < 1e-9);
  });
});

describe("titleMarkFontScale", () => {
  // A 360dp phone: 24dp margins and Home's 48dp Settings button leave 264dp.
  const narrow = { fontSize: 36, room: 264 };

  test("the title follows the phone's font scale while it fits its line", () => {
    assert.equal(titleMarkFontScale({ ...narrow, fontScale: 1 }), 1);
    assert.equal(titleMarkFontScale({ ...narrow, fontScale: 1.3 }), 1.3);
    assert.equal(titleMarkFontScale({ fontSize: 36, room: 363, fontScale: 2 }), 2);
  });

  test("it stops growing where the waves and the word fill the line", () => {
    // 54.36dp of waves, 8dp of gap and about 99dp of "Wave" are 161.36dp at scale 1.
    const scale = titleMarkFontScale({ ...narrow, fontScale: 2 });
    assert.ok(Math.abs(scale - 264 / 161.36) < 0.001);
  });

  test("it never goes under the standard size", () => {
    assert.equal(titleMarkFontScale({ fontSize: 36, room: 100, fontScale: 1.5 }), 1);
    assert.equal(titleMarkFontScale({ ...narrow, fontScale: 0.85 }), 0.85);
  });
});
