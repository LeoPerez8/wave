import {
  DEFAULT_THEME_CHOICE,
  readThemeChoice,
  themeFor,
  type ThemeChoice,
  type ThemeColors,
} from "@wave/core";
import { Storage } from "expo-sqlite/kv-store";
import { useSyncExternalStore } from "react";
import { Uniwind } from "uniwind";

const KEY = "settings.theme";

/** The colours as CSS variables (`--color-<token>`), the names global.css declares. */
const cssVariables = (colors: ThemeColors): Record<string, string> =>
  Object.fromEntries(Object.entries(colors).map(([token, value]) => [`--color-${token}`, value]));

/**
 * Lays the chosen colours over global.css's defaults. Every className and
 * `useThemeColor` reader (glass tint, native props) re-renders with them.
 */
const apply = (choice: ThemeChoice): void => {
  const theme = themeFor(choice);
  Uniwind.updateCSSVariables("light", cssVariables(theme.light));
  Uniwind.updateCSSVariables("dark", cssVariables(theme.dark));
};

let current = readThemeChoice(Storage.getItemSync(KEY));
apply(current);
const listeners = new Set<() => void>();

const publish = (next: ThemeChoice) => {
  current = next;
  Storage.setItemSync(KEY, JSON.stringify(next));
  apply(next);
  for (const listener of listeners) listener();
};

/** Picks a swatch for one group; the whole app recolours at once. */
export const setThemeSwatch = (group: keyof ThemeChoice, id: string): void => {
  // Read back through Core so an unknown id lands on the default.
  const next = readThemeChoice(JSON.stringify({ ...current, [group]: id }));
  if (next[group] === current[group]) return;
  publish(next);
};

/** Puts the shipped theme back. */
export const resetTheme = (): void => publish(DEFAULT_THEME_CHOICE);

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The persisted theme choice; re-renders when Settings changes it. */
export const useThemeChoice = (): ThemeChoice => useSyncExternalStore(subscribe, () => current);
