/**
 * What Android shows when Wave launches. Android draws the splash before
 * Wave's code runs, so the app saves this natively whenever the theme changes
 * and Android uses it from the next cold start.
 */

import type { ThemeColors } from "./theme.ts";
import { THEME_SWATCHES, isDefaultThemeChoice, themeFor, type ThemeChoice } from "./themeChoice.ts";

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

const splashThemeName = (choice: ThemeChoice): string =>
  `Theme.Wave.Launch.${choice.light}.${choice.dark}.${choice.primary}.${choice.secondary}`;

const launchColors = (scheme: ThemeColors): LaunchColors => ({
  background: scheme.background,
  primary: scheme.accent,
  secondary: scheme.highlight,
});

/** The launch theme for a theme choice. */
export const launchTheme = (choice: ThemeChoice): LaunchTheme => {
  const theme = themeFor(choice);
  return {
    splashTheme: isDefaultThemeChoice(choice) ? null : splashThemeName(choice),
    light: launchColors(theme.light),
    dark: launchColors(theme.dark),
  };
};

const ids = (group: keyof ThemeChoice): string[] =>
  THEME_SWATCHES[group].map((swatch) => swatch.id);

/**
 * One splash style per choice Settings › Theme can make, bar the shipped one
 * (the manifest's splash). A style serves both modes, so it is named by the
 * whole choice.
 */
export const LAUNCH_SPLASH_THEMES: readonly LaunchSplashTheme[] = ids("light").flatMap((light) =>
  ids("dark").flatMap((dark) =>
    ids("primary").flatMap((primary) =>
      ids("secondary").flatMap((secondary) => {
        const choice = { light, dark, primary, secondary };
        const { splashTheme, ...colors } = launchTheme(choice);
        return splashTheme === null ? [] : [{ name: splashTheme, choice, ...colors }];
      }),
    ),
  ),
);
