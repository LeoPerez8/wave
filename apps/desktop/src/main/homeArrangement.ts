import type { LibraryDatabase } from "@wave/client/db/database";
import { stampPreference } from "@wave/client/db/sync";
import {
  HOME_ARRANGEMENT_SETTING,
  editStoredHomeArrangement,
  parseHomeArrangement,
  type HomeArrangement,
  type HomeArrangementEdit,
} from "@wave/core";
import { keepPreference, syncedPreference } from "./sync/desktopSync.ts";

/** Home's sections and Discover rows as the account arranges them. */
export const homeArrangement = (db: LibraryDatabase): HomeArrangement =>
  parseHomeArrangement(syncedPreference(db, HOME_ARRANGEMENT_SETTING));

/**
 * Makes [edit] to the account's Home arrangement by Core's rules, keeps the result and stamps it
 * for sync to push. What the stored value names that this Wave doesn't draw stays in it.
 */
export const editDesktopHome = (
  db: LibraryDatabase,
  edit: HomeArrangementEdit,
): HomeArrangement => {
  const stored = editStoredHomeArrangement(syncedPreference(db, HOME_ARRANGEMENT_SETTING), edit);
  keepPreference(db, HOME_ARRANGEMENT_SETTING, stored);
  stampPreference(db, HOME_ARRANGEMENT_SETTING, Date.now());
  return parseHomeArrangement(stored);
};
