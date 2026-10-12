/**
 * The shortcut tab: a Library section the user picks in Settings, shown as a
 * third tab in the Home/Library pill. None (null) is the default and leaves
 * the tab bar as it always was.
 */
import type { LibrarySectionSlug } from "./librarySections.ts";

/** Settings' choices, in the order they are listed: None, then the Library's sections. */
export const SHORTCUT_TAB_CHOICES: readonly (LibrarySectionSlug | null)[] = [
  null,
  "playlists",
  "artists",
  "albums",
  "songs",
  "genres",
  "folders",
  "favorites",
];

/** The shortcut a stored value names; nothing stored, or anything unknown, is None. */
export const parseShortcutTab = (stored: string | null): LibrarySectionSlug | null =>
  SHORTCUT_TAB_CHOICES.find((choice) => choice !== null && choice === stored) ?? null;

/** The tab bar's tabs. */
export type TabBarTab = "index" | "library" | "shortcut" | "search";

/** The tabs in tab-bar order (which decides the side a switch slides in from). */
export const tabBarTabs = (shortcut: LibrarySectionSlug | null): readonly TabBarTab[] =>
  shortcut === null ? ["index", "library", "search"] : ["index", "library", "shortcut", "search"];
