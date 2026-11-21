/**
 * The Lyrics view's Karaoke button (docs/spec.md, "Karaoke"): off until it's turned on, then on
 * for every song, through restarts, until it's turned off. Kept in the device-local
 * `desktop_settings` store, never synced. Core times the words and picks the sung one.
 */
import type { LibraryDatabase } from "@wave/client/db/database";
import { sql } from "drizzle-orm";

import { preference, savePreference } from "../preferences.ts";

/** The phone's key for the same switch. */
const KARAOKE_SETTING = "settings.karaoke";

export interface KaraokeSwitchShape {
  /** Whether the Karaoke button is on. */
  readonly on: () => boolean;
  readonly setOn: (on: boolean) => void;
}

export const createKaraokeSwitch = (db: LibraryDatabase): KaraokeSwitchShape => ({
  on: () => preference(db, KARAOKE_SETTING) === "on",
  setOn: (value) => {
    if (value) savePreference(db, KARAOKE_SETTING, "on");
    else db.run(sql`DELETE FROM desktop_settings WHERE key=${KARAOKE_SETTING}`);
  },
});
