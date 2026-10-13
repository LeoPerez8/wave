import {
  DEFAULT_THEME_CHOICE,
  launchTheme,
  readThemeChoice,
  themeFor,
  type ThemeChoice,
  type ThemeColors,
} from "@wave/core";
import { Uniwind } from "uniwind";

import { persistedSetting, sameFields } from "@/lib/persistedSetting";
import { WaveNative } from "@/native/waveNative";
import { WavePlayer } from "@/native/wavePlayer";

/** The colours as CSS variables (`--color-<token>`), the names global.css declares. */
const cssVariables = (colors: ThemeColors): Record<string, string> =>
  Object.fromEntries(Object.entries(colors).map(([token, value]) => [`--color-${token}`, value]));

/**
 * Lays the chosen colours over global.css's defaults. Every className and
 * `useThemeColor` reader (glass tint, native props) re-renders with them, and
 * the media notification takes the primary. The choice is also saved natively
 * for the launch splash, which Android draws before this code runs; on every
 * start too, so it never drifts.
 */
const apply = (choice: ThemeChoice): void => {
  const theme = themeFor(choice);
  Uniwind.updateCSSVariables("light", cssVariables(theme.light));
  Uniwind.updateCSSVariables("dark", cssVariables(theme.dark));
  WavePlayer.setNotificationAccent(theme.light.accent, theme.dark.accent).catch((error: unknown) =>
    console.warn("[wave] Couldn't colour the notification", error),
  );
  WaveNative.setLaunchTheme(launchTheme(choice)).catch((error: unknown) =>
    console.warn("[wave] Saving the launch theme failed", error),
  );
};

const theme = persistedSetting<ThemeChoice>({
  key: "settings.theme",
  read: readThemeChoice,
  write: (choice) => JSON.stringify(choice),
  equals: sameFields,
  onValue: apply,
});

// Applied on import (the root layout imports this first), before anything renders.
theme.get();

/** Picks a swatch for one group; the whole app recolours at once. */
export const setThemeSwatch = (group: keyof ThemeChoice, id: string): void =>
  // Read back through Core so an unknown id lands on the default.
  theme.set(readThemeChoice(JSON.stringify({ ...theme.get(), [group]: id })));

/** Puts the shipped theme back. */
export const resetTheme = (): void => theme.set(DEFAULT_THEME_CHOICE);

/** The persisted theme choice; re-renders when Settings changes it. */
export const useThemeChoice = theme.useValue;
