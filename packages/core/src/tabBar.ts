/**
 * The tab bar the owner arranges (a long press on it opens its editor): Home,
 * always first, then any of Library, the Library's sections and Search, up to
 * five tabs. Search keeps its own round pill at the end whenever it's on.
 */
import { LIBRARY_SECTION_SLUGS, type LibrarySectionSlug } from "./librarySections.ts";
import { moveItem } from "./playlists.ts";

/** A tab: Home ("index"), Library, Search, or a Library section as a tab of its own. */
export type TabBarTab = "index" | "library" | "search" | LibrarySectionSlug;

/** The tabs in the bar, in order. */
export type TabBar = readonly TabBarTab[];

/** Every tab, in the order the editor lists those off the bar. */
const TABS: readonly TabBarTab[] = ["index", "library", ...LIBRARY_SECTION_SLUGS, "search"];

/** The most tabs the bar holds, Home and Search included. */
export const MAX_TABS = 5;

const isTab = (value: string): value is TabBarTab => TABS.some((tab) => tab === value);

/**
 * [tabs] held to the bar's rules: Home first, each tab once, Search last,
 * anything unknown left out, and no more than `MAX_TABS` (the last ones
 * before Search dropping off).
 */
const barOf = (tabs: readonly string[]): TabBar => {
  const known = new Set(tabs.filter(isTab));
  const search = known.has("search");
  const middle = [...known]
    .filter((tab) => tab !== "index" && tab !== "search")
    .slice(0, MAX_TABS - 1 - (search ? 1 : 0));
  return ["index", ...middle, ...(search ? (["search"] as const) : [])];
};

/** The bar of an install that never chose a shortcut tab. */
const DEFAULT_SHORTCUT: LibrarySectionSlug = "playlists";

/**
 * The bar the Shortcut tab setting (before the bar could be edited) stands
 * for: Home, Library, the shortcut and Search. Nothing stored was Playlists;
 * None or a section that left the Library (Folders) leaves the shortcut out.
 */
const fromShortcut = (shortcut: string | null): TabBar => {
  const section =
    shortcut === null ? DEFAULT_SHORTCUT : LIBRARY_SECTION_SLUGS.find((slug) => slug === shortcut);
  return section === undefined
    ? ["index", "library", "search"]
    : ["index", "library", section, "search"];
};

/**
 * The bar a stored value holds. With nothing stored, the bar the old Shortcut
 * tab setting ([shortcut], as stored) left.
 */
export const parseTabBar = (stored: string | null, shortcut: string | null): TabBar =>
  stored === null ? fromShortcut(shortcut) : barOf(stored.split(","));

/** What to store for [bar]; `parseTabBar` reads it back as that bar. */
export const storedTabBar = (bar: TabBar): string => bar.join(",");

/** Whether [bar] holds as many tabs as fit, so nothing more can be added. */
export const tabBarFull = (bar: TabBar): boolean => bar.length >= MAX_TABS;

/** The tabs [bar] doesn't hold, in the editor's order: Library, its sections, Search. */
export const tabsOffBar = (bar: TabBar): TabBarTab[] => TABS.filter((tab) => !bar.includes(tab));

/** The tabs between Home and the Search pill: those the editor can drag. */
export const movableTabs = (bar: TabBar): TabBarTab[] =>
  bar.filter((tab) => tab !== "index" && tab !== "search");

/** A change made in the tab bar's editor. */
export type TabBarEdit =
  | { readonly remove: TabBarTab }
  | { readonly add: TabBarTab }
  /** A tab dragged from one place among `movableTabs` to another (0-based). */
  | { readonly move: { readonly from: number; readonly to: number } };

/**
 * [bar] after [edit]: a removed tab leaves (never Home), an added one joins at
 * the end, before Search, unless the bar is full, and a dragged one lands
 * where it's dropped. Home stays first and Search last throughout.
 */
export const editTabBar = (bar: TabBar, edit: TabBarEdit): TabBar => {
  if ("remove" in edit) return bar.filter((tab) => tab === "index" || tab !== edit.remove);
  const search = bar.filter((tab) => tab === "search");
  if ("move" in edit) {
    return ["index", ...moveItem(movableTabs(bar), edit.move.from, edit.move.to), ...search];
  }
  if (bar.includes(edit.add) || tabBarFull(bar)) return bar;
  return barOf(["index", ...movableTabs(bar), edit.add, ...search]);
};
