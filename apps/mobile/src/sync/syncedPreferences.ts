/**
 * The synced preferences (docs/spec.md, "What syncs") as the Wave account
 * reads and applies them: by key-value store key, through the settings
 * themselves, so a value from the account shows at once.
 */
import { applySyncedSetting, syncedSettingValue } from "@/lib/persistedSetting";
// Each setting registers itself when its module loads; these are every synced one.
/* oxlint-disable import/no-unassigned-import */
import "@/settings/artistPhotos";
import "@/settings/bestQuality";
import "@/settings/bounceAmount";
import "@/settings/dontPlayExplicit";
import "@/settings/followedArtists";
import "@/settings/genius";
import "@/settings/glass";
import "@/settings/keepFindVisible";
import "@/settings/longPressDelay";
import "@/settings/lyricsAndGenre";
import "@/settings/nowPlayingButtons";
import "@/settings/shuffleKind";
import "@/settings/shazamPlaylist";
import "@/settings/swipeActions";
import "@/settings/tabBar";
import "@/settings/theme";
import "@/settings/ytMusic";
/* oxlint-enable import/no-unassigned-import */

import type { SyncPreferences } from "./syncCycle";

export const syncedPreferences: SyncPreferences = {
  value: syncedSettingValue,
  apply: (key, value) => {
    // A preference a newer Wave syncs is left alone.
    applySyncedSetting(key, value);
  },
};
