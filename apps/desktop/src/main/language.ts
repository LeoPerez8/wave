import type { LibraryDatabase } from "@wave/client/db/database";
import { stampPreference } from "@wave/client/db/sync";
import {
  chosenAppLanguage,
  LANGUAGE_PREFERENCE,
  readLanguageChoice,
  type LanguageChoice,
} from "@wave/core";
import type { LanguageView } from "../shared/language.ts";
import { keepPreference, syncedPreference } from "./sync/desktopSync.ts";

/** The account's language choice and the language it gives this computer ([preferred]). */
export const readDesktopLanguage = (
  db: LibraryDatabase,
  preferred: readonly string[],
): LanguageView => {
  const choice = readLanguageChoice(syncedPreference(db, LANGUAGE_PREFERENCE));
  return { choice, language: chosenAppLanguage(choice, preferred) };
};

/** Keeps the owner's choice and stamps it for sync to push. */
export const saveDesktopLanguage = (db: LibraryDatabase, choice: LanguageChoice): void => {
  // System is kept as a value, not removed: it must replace an earlier choice on other devices.
  keepPreference(db, LANGUAGE_PREFERENCE, choice);
  stampPreference(db, LANGUAGE_PREFERENCE, Date.now());
};
