/**
 * What Android shows when Wave launches. Android draws the splash before
 * Wave's code runs, so the app saves this natively whenever the theme changes
 * and Android uses it from the next cold start.
 */

import type { ThemeColors } from "./theme.ts";
import { launcherIconFor, type LauncherIcon } from "./launcherIcon.ts";
import { INK_PALETTE, INK_PAIRS, inkPairFor, type InkPair, type PaletteInk } from "./inkPalette.ts";
import {
  CUSTOM_INK,
  DEFAULT_THEME_CHOICE,
  THEME_SWATCHES,
  isDefaultThemeChoice,
  themeFor,
  type ThemeChoice,
  type ThemeGroup,
  type Scheme,
} from "./themeChoice.ts";

/** One mode's launch colours, as the app draws them. */
export interface LaunchColors {
  readonly background: string;
  /** The accent (the logo's top wave), as readable on the background as in the app. */
  readonly primary: string;
  /** The highlight (the logo's bottom wave), as readable on the background as in the app. */
  readonly secondary: string;
}

export interface LaunchTheme {
  /**
   * The splash style resource to open with (Android 13+), or null for the
   * manifest's, which has the shipped theme.
   */
  readonly splashTheme: string | null;
  readonly light: LaunchColors;
  readonly dark: LaunchColors;
}

/**
 * A splash style the app ships: its resource name, the choice it stands for
 * and the colours it shows in each mode.
 */
export interface LaunchSplashTheme {
  readonly name: string;
  readonly choice: ThemeChoice;
  readonly light: LaunchColors;
  readonly dark: LaunchColors;
}

const catalogId = (catalog: readonly { readonly id: string }[], name: string): string =>
  Math.max(
    0,
    catalog.findIndex((entry) => entry.id === name),
  ).toString(36);

/** Base-36 catalog positions keep the 20,735 style names short and unique. */
const splashThemeName = (choice: ThemeChoice): string =>
  `Wl.${catalogId(THEME_SWATCHES.light, choice.light)}.${catalogId(THEME_SWATCHES.dark, choice.dark)}.${catalogId(INK_PALETTE, choice.primary)}.${catalogId(INK_PALETTE, choice.secondary)}`;

const launchColors = (scheme: ThemeColors): LaunchColors => ({
  background: scheme.background,
  primary: scheme.accent,
  secondary: scheme.highlight,
});

// Each mode's tones depend only on its ground and one palette ink, not the
// other mode or wave. Reuse those corrections across the catalog's pairs.
const paletteTones = new Map<string, LaunchColors>();
const paletteTone = (choice: ThemeChoice, ink: PaletteInk, scheme: Scheme): LaunchColors => {
  const key = `${scheme}/${choice[scheme]}/${ink[scheme]}`;
  let colors = paletteTones.get(key);
  if (colors === undefined) {
    colors = launchColors(
      themeFor({
        ...choice,
        primary: CUSTOM_INK,
        secondary: CUSTOM_INK,
        customPrimary: ink[scheme],
        customSecondary: ink[scheme],
      })[scheme],
    );
    paletteTones.set(key, colors);
  }
  return colors;
};

/** One mode's ground with a palette pair's waves, each ink corrected for that ground. */
const pairColours = (choice: ThemeChoice, pair: InkPair, scheme: Scheme): LaunchColors => {
  const primary = paletteTone(choice, pair.primary, scheme);
  const secondary = paletteTone(choice, pair.secondary, scheme);
  return {
    background: primary.background,
    primary: primary.primary,
    secondary: secondary.secondary,
  };
};

/**
 * A palette splash's native style and colours. Pass a catalog pair to
 * generate its resources, or omit it to match a user's choice.
 */
export const paletteSplashThemeFor = (
  choice: ThemeChoice,
  pair: InkPair = inkPairFor(choice),
): LaunchSplashTheme | null => {
  const matched = {
    ...choice,
    primary: pair.primary.id,
    secondary: pair.secondary.id,
    customPrimary: null,
    customSecondary: null,
  };
  if (isDefaultThemeChoice(matched)) return null;
  return {
    name: splashThemeName(matched),
    choice: matched,
    light: pairColours(choice, pair, "light"),
    dark: pairColours(choice, pair, "dark"),
  };
};

/**
 * The launch theme: the choice's grounds, with the waves of this phone's stored
 * icon (the icon the choice shows when none is given). The native logo and
 * Android's splash style take the same palette tones, so the splash matches
 * the icon even when the app's colours don't.
 */
export const launchTheme = (
  choice: ThemeChoice,
  icon: LauncherIcon = launcherIconFor(choice),
): LaunchTheme => {
  const pair = INK_PAIRS.find((candidate) => candidate.id === icon.id)!;
  return {
    splashTheme: paletteSplashThemeFor(choice, pair)?.name ?? null,
    light: pairColours(choice, pair, "light"),
    dark: pairColours(choice, pair, "dark"),
  };
};

const ids = (group: ThemeGroup): string[] => THEME_SWATCHES[group].map((swatch) => swatch.id);

/**
 * One splash style per background pair and palette ink pair, bar the shipped
 * one (the manifest's splash). A style serves both modes.
 */
export const LAUNCH_SPLASH_THEMES: readonly LaunchSplashTheme[] = ids("light").flatMap((light) =>
  ids("dark").flatMap((dark) =>
    INK_PAIRS.flatMap((pair) => {
      const theme = paletteSplashThemeFor({ ...DEFAULT_THEME_CHOICE, light, dark }, pair);
      return theme === null ? [] : [theme];
    }),
  ),
);
