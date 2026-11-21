import type { LibraryDatabase } from "@wave/client/db/database";
import { stampPreference } from "@wave/client/db/sync";
import { editThemeChoice, readThemeChoice, type ThemeEdit } from "@wave/core";
import { keepPreference, syncedPreference } from "./sync/desktopSync.ts";

/** The synced setting that holds the theme choice, the phone's key. */
export const THEME_PREFERENCE = "settings.theme";

/**
 * Makes [edit] to the account's theme by Core's theme choice rules, keeps the result and stamps
 * it for sync to push. Gives the theme as it is kept, the JSON the phone writes.
 */
export const editDesktopTheme = (db: LibraryDatabase, edit: ThemeEdit): string => {
  const choice = readThemeChoice(syncedPreference(db, THEME_PREFERENCE));
  const stored = JSON.stringify(editThemeChoice(choice, edit));
  keepPreference(db, THEME_PREFERENCE, stored);
  stampPreference(db, THEME_PREFERENCE, Date.now());
  return stored;
};
