import type { LibraryDatabase } from "@wave/client/db/database";
import type { WindowSettings } from "../../shared/windowSettings.ts";
import { preference, savePreference } from "../preferences.ts";

export const readWindowSettings = (db: LibraryDatabase): WindowSettings => ({
  closeQuits: preference(db, "window.closeQuits") === "true",
  startWithSystem: preference(db, "window.startWithSystem") === "true",
});

export const changeWindowSettings = async (
  db: LibraryDatabase,
  change: Partial<WindowSettings>,
  setLogin: (on: boolean) => Promise<void>,
): Promise<WindowSettings> => {
  if (change.startWithSystem !== undefined) await setLogin(change.startWithSystem);
  for (const [key, value] of Object.entries(change))
    savePreference(db, `window.${key}`, String(value));
  return readWindowSettings(db);
};
