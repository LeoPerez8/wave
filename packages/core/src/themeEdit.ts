/**
 * One change made in the theme editor, as a value: the desktop's window sends
 * it to the process that holds the synced theme, which checks it
 * (`readThemeEdit`) and applies it with the theme choice rules
 * (`editThemeChoice`).
 */

import { parseHexColour } from "./colour.ts";
import {
  THEME_SWATCHES,
  chooseCustomInk,
  chooseSavedInk,
  chooseThemeSwatch,
  removeSavedInk,
  resetThemeChoice,
  saveInk,
  type InkGroup,
  type ThemeChoice,
  type ThemeGroup,
} from "./themeChoice.ts";

/** What an edit does with a colour of Primary or Secondary. */
type InkEditKind = "saved" | "custom" | "save" | "remove";

export type ThemeEdit =
  /** A preset swatch of any row is chosen. */
  | { readonly kind: "swatch"; readonly group: ThemeGroup; readonly id: string }
  /**
   * A colour of Primary or Secondary, `#rrggbb`: a saved one is chosen
   * (`saved`), the picker's is chosen (`custom`) or saved without applying
   * (`save`), or a saved one is removed (`remove`).
   */
  | { readonly kind: InkEditKind; readonly group: InkGroup; readonly hex: string }
  /** Reset to Defaults. */
  | { readonly kind: "reset" };

const INK_EDITS: readonly unknown[] = ["saved", "custom", "save", "remove"];

const isGroup = (value: unknown): value is ThemeGroup =>
  typeof value === "string" && Object.hasOwn(THEME_SWATCHES, value);

const isInkGroup = (value: unknown): value is InkGroup =>
  value === "primary" || value === "secondary";

/**
 * The edit `value` holds, its colour as `#rrggbb`; null when it isn't one: an
 * unknown kind or row, a swatch the row doesn't have, or text that isn't a colour.
 */
export const readThemeEdit = (value: unknown): ThemeEdit | null => {
  if (typeof value !== "object" || value === null) return null;
  const { kind, group, id, hex } = value as Readonly<Record<string, unknown>>;
  if (kind === "reset") return { kind };
  if (kind === "swatch")
    return isGroup(group) && THEME_SWATCHES[group].some((swatch) => swatch.id === id)
      ? { kind, group, id: id as string }
      : null;
  if (!INK_EDITS.includes(kind) || !isInkGroup(group) || typeof hex !== "string") return null;
  const colour = parseHexColour(hex);
  return colour === null ? null : { kind: kind as InkEditKind, group, hex: colour };
};

/** `choice` after `edit`, by the theme choice rules. */
export const editThemeChoice = (choice: ThemeChoice, edit: ThemeEdit): ThemeChoice => {
  switch (edit.kind) {
    case "reset":
      return resetThemeChoice(choice);
    case "swatch":
      return chooseThemeSwatch(choice, edit.group, edit.id);
    case "saved":
      return chooseSavedInk(choice, edit.group, edit.hex);
    case "custom":
      return chooseCustomInk(choice, edit.group, edit.hex);
    case "save":
      return saveInk(choice, edit.group, edit.hex);
    case "remove":
      return removeSavedInk(choice, edit.group, edit.hex);
  }
};
