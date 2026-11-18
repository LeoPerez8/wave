import { FIND_LYRICS_AND_GENRE_SETTING, readFindLyricsAndGenre } from "@wave/core";
import type { LibraryDatabase } from "@wave/client/db/database";
import { syncedPreference } from "./sync/desktopSync.ts";

/** The phone's synced switch (Core's key and reading); online tag and lyric lookups default to on. */
export const LOOKUPS_SETTING = FIND_LYRICS_AND_GENRE_SETTING;
export const lookupsEnabled = (db: LibraryDatabase): boolean =>
  readFindLyricsAndGenre(syncedPreference(db, LOOKUPS_SETTING));
