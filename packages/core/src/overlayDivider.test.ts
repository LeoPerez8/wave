import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DEFAULT_THEME,
  DEFAULT_THEME_CHOICE,
  GLASS_SETTINGS,
  THEME_SWATCHES,
  contrastRatio,
  overlayDivider,
  themeFor,
  type ThemeColors,
} from "./index.ts";

const channels = (hex: string): number[] =>
  [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));

const toHex = (rgb: readonly number[]): string =>
  `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;

/** `top` laid over `under` at `alpha` (0–1), as the screen shows it. */
const over = (top: string, alpha: number, under: string): string => {
  const below = channels(under);
  return toHex(channels(top).map((c, i) => c * alpha + (below[i] ?? 0) * (1 - alpha)));
};

/** An `#rrggbbaa` colour laid over an opaque ground. */
const composite = (colour: string, ground: string): string =>
  over(colour.slice(0, 7), Number.parseInt(colour.slice(7, 9), 16) / 255, ground);

/** What an overlay card can show behind its dividers: the opaque fallback, or glass over anything. */
const cardGrounds = (colors: ThemeColors): string[] => {
  const tints = GLASS_SETTINGS.tint.levels;
  const backdrops = ["#000000", "#ffffff", "#808080", colors.background, colors.foreground];
  return [
    colors.surface,
    ...tints.flatMap((tint) =>
      backdrops.map((backdrop) => over(colors.surface, tint / 100, backdrop)),
    ),
  ];
};

const allThemes = (): { name: string; colors: ThemeColors }[] => [
  { name: "default light", colors: DEFAULT_THEME.light },
  { name: "default dark", colors: DEFAULT_THEME.dark },
  ...THEME_SWATCHES.light.map((swatch) => ({
    name: `light ${swatch.id}`,
    colors: themeFor({ ...DEFAULT_THEME_CHOICE, light: swatch.id }).light,
  })),
  ...THEME_SWATCHES.dark.map((swatch) => ({
    name: `dark ${swatch.id}`,
    colors: themeFor({ ...DEFAULT_THEME_CHOICE, dark: swatch.id }).dark,
  })),
];

/** The contrast a divider shows against the card ground it's drawn on. */
const dividerContrast = (colors: ThemeColors, ground: string): number =>
  contrastRatio(composite(overlayDivider(colors.foreground), ground), ground);

describe("overlayDivider", () => {
  test("is the text colour, see-through", () => {
    const divider = overlayDivider("#121b1d");
    assert.match(divider, /^#121b1d[0-9a-f]{2}$/i);
    assert.notEqual(divider.slice(7), "ff");
    assert.notEqual(divider.slice(7), "00");
  });

  test("stands off every card ground, in every theme, at any glass setting", () => {
    for (const { name, colors } of allThemes()) {
      for (const ground of cardGrounds(colors)) {
        const ratio = dividerContrast(colors, ground);
        assert.ok(ratio >= 1.3, `${name} on ${ground}: ${ratio.toFixed(2)}`);
      }
    }
  });

  test("stays quiet: short of the 3:1 of a mark that must be seen", () => {
    for (const { name, colors } of allThemes()) {
      for (const ground of cardGrounds(colors)) {
        const ratio = dividerContrast(colors, ground);
        assert.ok(ratio <= 2.25, `${name} on ${ground}: ${ratio.toFixed(2)}`);
      }
    }
  });

  test("shows more than the separator hairline it replaces on the opaque card", () => {
    for (const { name, colors } of allThemes()) {
      assert.ok(
        dividerContrast(colors, colors.surface) > contrastRatio(colors.separator, colors.surface),
        name,
      );
    }
  });
});
