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
  titleMarkPlacement,
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
  test("the waves stand at 60% of the large title's capitals, on its baseline", () => {
    // Inter's capitals are 1490 of 2048 units tall; the waves take 60% of them.
    const layout = titleMarkLayout({ fontSize: 26, lineHeight: 32 });
    assert.ok(Math.abs(layout.height - 11.35) < 0.01);
    // The logo is 2.2 units wide and 1.06 tall, round caps included.
    assert.ok(Math.abs(layout.width - 23.55) < 0.01);
    // Inter's line box is centred in the 32dp line, with the waves resting on its baseline.
    assert.ok(Math.abs(layout.baseline - 6.55) < 0.01);
    // One 8dp cell between the waves and the word.
    assert.ok(Math.abs(layout.gap - 8) < 1e-9);
  });

  test("the waves grow with the font size", () => {
    const base = titleMarkLayout({ fontSize: 26, lineHeight: 32 });
    const doubled = titleMarkLayout({ fontSize: 52, lineHeight: 64 });
    assert.ok(Math.abs(doubled.height - 2 * base.height) < 1e-9);
    assert.ok(Math.abs(doubled.width - 2 * base.width) < 1e-9);
    assert.ok(Math.abs(doubled.baseline - 2 * base.baseline) < 1e-9);
    assert.ok(Math.abs(doubled.gap - 2 * base.gap) < 1e-9);
  });

  test("the stroke keeps the logo's proportions", () => {
    const { width, stroke } = titleMarkLayout({ fontSize: 26, lineHeight: 32 });
    assert.ok(Math.abs(stroke / width - LOGO_WAVES.stroke / (2 + LOGO_WAVES.stroke)) < 1e-9);
  });
});

describe("titleMarkPlacement", () => {
  const type = { fontSize: 26, lineHeight: 32 };
  // Android 14 at font scale 2.0 scales large text by less than 2×.
  const line = { capHeight: 30.18, height: 48.8, baseline: 38.4 };

  test("the waves match the word as the phone drew it, not the font scale", () => {
    const placement = titleMarkPlacement({ line, fontScale: 2, type });
    assert.ok(placement !== undefined);
    assert.ok(Math.abs(placement.height - 18.108) < 1e-9);
    // The logo is 2.2 units wide and 1.06 tall.
    assert.ok(Math.abs(placement.width - 37.58) < 0.01);
    // The baseline is 38.4dp down a 48.8dp line: 10.4dp above its bottom.
    assert.ok(Math.abs(placement.baseline - 10.4) < 1e-9);
    // The measured cap height scales the 8dp base gap to 12.75dp.
    assert.ok(Math.abs(placement.gap - 12.75) < 0.02);
  });

  test("a measured line wins at the standard font scale too", () => {
    const placement = titleMarkPlacement({ line, fontScale: 1, type });
    assert.ok(placement !== undefined);
    assert.ok(Math.abs(placement.height - 18.108) < 1e-9);
  });

  test("before the line is measured, the standard font scale shows Inter's own size", () => {
    assert.deepEqual(
      titleMarkPlacement({ line: undefined, fontScale: 1, type }),
      titleMarkLayout(type),
    );
  });

  test("before the line is measured, any other font scale shows no waves", () => {
    assert.equal(titleMarkPlacement({ line: undefined, fontScale: 1.3, type }), undefined);
    assert.equal(titleMarkPlacement({ line: undefined, fontScale: 2, type }), undefined);
    assert.equal(titleMarkPlacement({ line: undefined, fontScale: 0.85, type }), undefined);
  });
});

describe("titleMarkFontScale", () => {
  // A 360dp phone: 24dp margins and Home's 48dp Settings button leave 264dp.
  const narrow = { fontSize: 26, room: 264 };

  test("the title follows the phone's font scale while it fits its line", () => {
    assert.equal(titleMarkFontScale({ ...narrow, fontScale: 1 }), 1);
    assert.equal(titleMarkFontScale({ ...narrow, fontScale: 1.3 }), 1.3);
    assert.equal(titleMarkFontScale({ fontSize: 26, room: 232, fontScale: 2 }), 2);
  });

  test("it stops growing where the waves and the word fill the line", () => {
    // About 23.55dp of waves, 8dp of gap and 71.5dp of "Wave" fit in 160dp.
    const scale = titleMarkFontScale({ fontSize: 26, room: 160, fontScale: 2 });
    assert.ok(Math.abs(scale - 160 / 103.05) < 0.001);
  });

  test("it never goes under the standard size", () => {
    assert.equal(titleMarkFontScale({ fontSize: 26, room: 80, fontScale: 1.5 }), 1);
    assert.equal(titleMarkFontScale({ ...narrow, fontScale: 0.85 }), 0.85);
  });
});
