/**
 * Settings › Appearance › Appearance: whether Wave follows Android's light or
 * dark setting (System, the default and how Wave always behaved) or keeps to
 * one scheme whatever Android says.
 */

import type { Theme } from "./theme.ts";

export type Appearance = "system" | "light" | "dark";

/** The choices in the order Settings lists them. */
export const APPEARANCES: readonly { readonly id: Appearance; readonly label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

const DEFAULT_APPEARANCE: Appearance = "system";

/** The appearance from what's stored; nothing or anything unknown is System. */
export const readAppearance = (stored: string | null): Appearance =>
  APPEARANCES.find(({ id }) => id === stored)?.id ?? DEFAULT_APPEARANCE;

/** What to store for `appearance`: nothing for the default, so it reads back as System. */
export const storedAppearance = (appearance: Appearance): string | null =>
  appearance === DEFAULT_APPEARANCE ? null : appearance;

/**
 * The primary's tone for each of Android's schemes, as the media notification
 * takes it: each scheme's own under System; Light and Dark keep theirs in
 * both, since Wave stays in that scheme whatever Android says.
 */
export const appearanceAccent = (
  theme: Theme,
  appearance: Appearance,
): { readonly light: string; readonly dark: string } =>
  appearance === "system"
    ? { light: theme.light.accent, dark: theme.dark.accent }
    : { light: theme[appearance].accent, dark: theme[appearance].accent };
