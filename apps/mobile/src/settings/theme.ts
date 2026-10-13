import {
  DEFAULT_THEME_CHOICE,
  launcherIconSwitch,
  readThemeChoice,
  themeFor,
  type LauncherIconSwitch,
  type ThemeChoice,
  type ThemeColors,
} from "@wave/core";
import { Uniwind } from "uniwind";

import { persistedSetting, sameFields } from "@/lib/persistedSetting";
import { WavePlayer } from "@/native/wavePlayer";

import { LAUNCHER, showLauncherIconFor } from "./launcherIcon";

/** The colours as CSS variables (`--color-<token>`), the names global.css declares. */
const cssVariables = (colors: ThemeColors): Record<string, string> =>
  Object.fromEntries(Object.entries(colors).map(([token, value]) => [`--color-${token}`, value]));

/**
 * Lays the chosen colours over global.css's defaults. Every className and
 * `useThemeColor` reader (glass tint, native props) re-renders with them, the
 * media notification takes the primary, and the launcher icon follows the
 * primary and secondary.
 */
const apply = (choice: ThemeChoice): void => {
  const theme = themeFor(choice);
  Uniwind.updateCSSVariables("light", cssVariables(theme.light));
  Uniwind.updateCSSVariables("dark", cssVariables(theme.dark));
  WavePlayer.setNotificationAccent(theme.light.accent, theme.dark.accent).catch((error: unknown) =>
    console.warn("[wave] Couldn't colour the notification", error),
  );
  showLauncherIconFor(choice);
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

/** Asks the person to agree to a change (`confirmAction`); resolves whether they did. */
export type Confirm = (warning: NonNullable<LauncherIconSwitch["warning"]>) => Promise<boolean>;

/**
 * Switches to `next`; the whole app recolours at once. When that switches the
 * launcher icon and the launcher drops the home-screen icon on a switch,
 * `confirm` is asked first, and nothing changes unless it agrees.
 */
const changeTheme = async (next: ThemeChoice, confirm: Confirm): Promise<void> => {
  const warning = launcherIconSwitch(theme.get(), next, LAUNCHER)?.warning ?? null;
  if (warning !== null && !(await confirm(warning))) return;
  theme.set(next);
};

/** Picks a swatch for one group. */
export const setThemeSwatch = (
  group: keyof ThemeChoice,
  id: string,
  confirm: Confirm,
): Promise<void> =>
  // Read back through Core so an unknown id lands on the default.
  changeTheme(readThemeChoice(JSON.stringify({ ...theme.get(), [group]: id })), confirm);

/** Puts the shipped theme back, teal-over-amber icon included. */
export const resetTheme = (confirm: Confirm): Promise<void> =>
  changeTheme(DEFAULT_THEME_CHOICE, confirm);

/** The persisted theme choice; re-renders when Settings changes it. */
export const useThemeChoice = theme.useValue;
