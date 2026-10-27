import type { RecapColour, ThemeColors } from "@wave/core";
import { useCSSVariable } from "uniwind";

/**
 * A colour token of global.css (`--color-<name>`): the theme's and a Recap's
 * fixed colours.
 */
export type ThemeColor = keyof ThemeColors | `recap-${RecapColour}` | "on-recap";

/**
 * Reads a colour token from global.css for native props that can't take a
 * className (navigation options, icon colours, status bar). Updates when the
 * system theme or the theme chosen in Settings changes.
 */
export function useThemeColor(name: ThemeColor): string;
export function useThemeColor<const T extends readonly ThemeColor[]>(
  names: T,
): { -readonly [K in keyof T]: string };
export function useThemeColor(name: ThemeColor | readonly ThemeColor[]): string | string[] {
  const names = typeof name === "string" ? [name] : name;
  const values = useCSSVariable(names.map((token) => `--color-${token}`));
  const colors = values.map((value) => (typeof value === "string" ? value : "transparent"));
  return typeof name === "string" ? colors[0]! : colors;
}
