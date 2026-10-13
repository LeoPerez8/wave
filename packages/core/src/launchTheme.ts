/**
 * What Android shows when Wave launches. Android draws the splash before
 * Wave's code runs, so the app saves this natively whenever the theme changes
 * and Android uses it from the next cold start.
 */

import type { ThemeColors } from "./theme.ts";
import { DEFAULT_THEME_CHOICE, THEME_SWATCHES, themeFor, type ThemeChoice } from "./themeChoice.ts";

/** One mode's launch colours, as the app draws them. */
export interface LaunchColors {
  readonly background: string;
  /** The accent, as readable on the background as in the app. */
  readonly primary: string;
  /** The highlight, as readable on the background as in the app. */
  readonly secondary: string;
}

export interface LaunchTheme {
  /**
   * The splash style resource to open with (Android 13+), or null for the
   * manifest's, which has the shipped grounds.
   */
  readonly splashTheme: string | null;
  readonly light: LaunchColors;
  readonly dark: LaunchColors;
}

/** A splash style the app ships: its resource name and the ground it shows in each mode. */
export interface LaunchSplashTheme {
  readonly name: string;
  readonly light: string;
  readonly dark: string;
}

const splashThemeName = (light: string, dark: string): string =>
  `Theme.Wave.Launch.${light}.${dark}`;

const isShippedGround = (light: string, dark: string): boolean =>
  light === DEFAULT_THEME_CHOICE.light && dark === DEFAULT_THEME_CHOICE.dark;

/**
 * One splash style per pair of light and dark backgrounds, bar the shipped
 * pair (the manifest's splash). A style serves both modes, so it needs both.
 */
export const LAUNCH_SPLASH_THEMES: readonly LaunchSplashTheme[] = THEME_SWATCHES.light.flatMap(
  (light) =>
    THEME_SWATCHES.dark
      .filter((dark) => !isShippedGround(light.id, dark.id))
      .map((dark) => {
        const theme = themeFor({ ...DEFAULT_THEME_CHOICE, light: light.id, dark: dark.id });
        return {
          name: splashThemeName(light.id, dark.id),
          light: theme.light.background,
          dark: theme.dark.background,
        };
      }),
);

/** The launch theme for a theme choice. */
const launchColors = (scheme: ThemeColors): LaunchColors => ({
  background: scheme.background,
  primary: scheme.accent,
  secondary: scheme.highlight,
});

export const launchTheme = (choice: ThemeChoice): LaunchTheme => {
  const theme = themeFor(choice);
  return {
    splashTheme: isShippedGround(choice.light, choice.dark)
      ? null
      : splashThemeName(choice.light, choice.dark),
    light: launchColors(theme.light),
    dark: launchColors(theme.dark),
  };
};
