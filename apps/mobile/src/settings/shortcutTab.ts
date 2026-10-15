import { type LibrarySectionSlug, parseShortcutTab, storedShortcutTab } from "@wave/core";

import { persistedSetting } from "@/lib/persistedSetting";

const shortcutTab = persistedSetting<LibrarySectionSlug | null>({
  key: "settings.shortcutTab",
  read: parseShortcutTab,
  write: storedShortcutTab,
});

/** Picks the Library section shown as a shortcut tab, or none (null). */
export const setShortcutTab = shortcutTab.set;

/** The persisted shortcut tab (Playlists until one is picked, null for None); re-renders when Settings changes it. */
export const useShortcutTab = shortcutTab.useValue;
