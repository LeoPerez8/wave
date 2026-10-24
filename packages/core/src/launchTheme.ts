/**
 * What Android shows when Wave launches. Android draws the splash before
 * Wave's code runs, so the app saves this natively whenever the theme changes
 * and Android uses it from the next cold start.
 */

import type { ThemeColors } from "./theme.ts";
import { inkPairFor, type InkPair } from "./inkPalette.ts";
import {
  CUSTOM_INK,
  DEFAULT_THEME_CHOICE,
  THEME_SWATCHES,
  isDefaultThemeChoice,
  presetThemeChoice,
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

const splashThemeName = (choice: ThemeChoice): string =>
  `Theme.Wave.Launch.${choice.light}.${choice.dark}.${choice.primary}.${choice.secondary}`;

const launchColors = (scheme: ThemeColors): LaunchColors => ({
  background: scheme.background,
  primary: scheme.accent,
  secondary: scheme.highlight,
});

/**
 * A palette splash's native style and colours. #656 can pass a catalog pair
 * to generate its resources, or omit it to match a user's choice. Until that
 * ticket switches the plugin and runtime together, `launchTheme` and
 * `LAUNCH_SPLASH_THEMES` keep naming the existing preset-only resources.
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
  const colours = (scheme: Scheme): LaunchColors =>
    launchColors(
      themeFor({
        ...choice,
        primary: CUSTOM_INK,
        secondary: CUSTOM_INK,
        customPrimary: pair.primary[scheme],
        customSecondary: pair.secondary[scheme],
      })[scheme],
    );
  return {
    name: splashThemeName(matched),
    choice: matched,
    light: colours("light"),
    dark: colours("dark"),
  };
};

/** The style for a choice's splash, which ships per preset only. */
const splashThemeFor = (choice: ThemeChoice): string | null => {
  // A chosen custom colour shows as the preset closest to it; a kept one that isn't chosen doesn't count.
  const preset = { ...presetThemeChoice(choice), customPrimary: null, customSecondary: null };
  return isDefaultThemeChoice(preset) ? null : splashThemeName(preset);
};

/**
 * The launch theme for a theme choice. The colours are what the app draws; a
 * custom colour opens on the splash of the preset closest to it.
 */
export const launchTheme = (choice: ThemeChoice): LaunchTheme => {
  const theme = themeFor(choice);
  return {
    splashTheme: splashThemeFor(choice),
    light: launchColors(theme.light),
    dark: launchColors(theme.dark),
  };
};

const ids = (group: ThemeGroup): string[] => THEME_SWATCHES[group].map((swatch) => swatch.id);

/**
 * One splash style per choice Settings › Theme can make, bar the shipped one
 * (the manifest's splash). A style serves both modes, so it is named by the
 * whole choice.
 */
export const LAUNCH_SPLASH_THEMES: readonly LaunchSplashTheme[] = ids("light").flatMap((light) =>
  ids("dark").flatMap((dark) =>
    ids("primary").flatMap((primary) =>
      ids("secondary").flatMap((secondary) => {
        const choice = { ...DEFAULT_THEME_CHOICE, light, dark, primary, secondary };
        const { splashTheme, ...colors } = launchTheme(choice);
        return splashTheme === null ? [] : [{ name: splashTheme, choice, ...colors }];
      }),
    ),
  ),
);
