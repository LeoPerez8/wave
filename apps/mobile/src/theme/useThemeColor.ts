import { useCSSVariable } from "uniwind";

export type ThemeColor =
  | "background"
  | "grouped"
  | "surface"
  | "foreground"
  | "secondary"
  | "tertiary"
  | "separator"
  | "fill"
  | "accent"
  | "highlight";

/**
 * Reads a colour token from global.css for native props that can't take a
 * className (navigation options, icon colours, status bar). Updates when the
 * system theme changes.
 */
export const useThemeColor = (name: ThemeColor): string => {
  const value = useCSSVariable(`--color-${name}`);
  return typeof value === "string" ? value : "transparent";
};
