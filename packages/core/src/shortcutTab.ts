/**
 * The shortcut tab: a Library section the user picks in Settings, shown as a
 * third tab in the Home/Library pill. Playlists is the default; None (null)
 * leaves the tab bar as Home, Library and Search.
 */
import { LIBRARY_SECTION_SLUGS, type LibrarySectionSlug } from "./librarySections.ts";

/** Settings' choices, in the order they are listed: None, then the Library's sections. */
export const SHORTCUT_TAB_CHOICES: readonly (LibrarySectionSlug | null)[] = [
  null,
  ...LIBRARY_SECTION_SLUGS,
];

/** The shortcut tab of an install that never picked one. */
export const DEFAULT_SHORTCUT_TAB: LibrarySectionSlug = "playlists";

/** How None is stored, so choosing it isn't read back as the default. */
const NONE_STORED = "none";

/** The shortcut a stored value names: nothing stored is the default, anything unknown is None. */
export const parseShortcutTab = (stored: string | null): LibrarySectionSlug | null =>
  stored === null
    ? DEFAULT_SHORTCUT_TAB
    : (SHORTCUT_TAB_CHOICES.find((choice) => choice !== null && choice === stored) ?? null);

/** What to store for [choice]; `parseShortcutTab` reads it back as that choice. */
export const storedShortcutTab = (choice: LibrarySectionSlug | null): string =>
  choice ?? NONE_STORED;

/** The tab bar's tabs. */
export type TabBarTab = "index" | "library" | "shortcut" | "search";

/** The tabs in tab-bar order (which decides the side a switch slides in from). */
export const tabBarTabs = (shortcut: LibrarySectionSlug | null): readonly TabBarTab[] =>
  shortcut === null ? ["index", "library", "search"] : ["index", "library", "shortcut", "search"];
