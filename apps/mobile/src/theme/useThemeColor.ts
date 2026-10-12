import type { ThemeColors } from "@wave/core";
import { useCSSVariable } from "uniwind";

/** A colour token of global.css (`--color-<name>`). */
export type ThemeColor = keyof ThemeColors;

/**
 * Reads a colour token from global.css for native props that can't take a
 * className (navigation options, icon colours, status bar). Updates when the
 * system theme or the theme chosen in Settings changes.
 */
export const useThemeColor = (name: ThemeColor): string => {
  const value = useCSSVariable(`--color-${name}`);
  return typeof value === "string" ? value : "transparent";
};
