import type { LibraryDatabase } from "@wave/client/db/database";
import { syncedPreference } from "./sync/desktopSync.ts";

/** The phone's synced switch; online tag and lyric lookups default to on. */
export const LOOKUPS_SETTING = "settings.findLyricsAndGenre";
export const lookupsEnabled = (db: LibraryDatabase): boolean =>
  syncedPreference(db, LOOKUPS_SETTING) !== "off";
