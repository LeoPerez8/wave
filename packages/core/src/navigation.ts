/**
 * Where screens live. The tabs are Home, Library, the shortcut tab and Search.
 * Screens opened from the Library are pushed over the tabs (they keep the mini
 * player, not the tab bar); screens opened from the shortcut tab stay inside
 * it, under the tab bar, so switching away and back keeps your place.
 */
import type { TabBarTab } from "./shortcutTab.ts";

/** Each tab's own screen. */
export const TAB_PATH = {
  index: "/",
  library: "/library",
  shortcut: "/shortcut",
  search: "/search",
} as const satisfies Record<TabBarTab, string>;

const TABS = Object.keys(TAB_PATH) as TabBarTab[];

const under = (pathname: string, root: string): boolean => pathname.startsWith(`${root}/`);

/** The tab `pathname` is drawn in (under the tab bar), or null for a screen pushed over the tabs. */
export const tabOfPath = (pathname: string): TabBarTab | null => {
  if (under(pathname, TAB_PATH.shortcut)) return "shortcut";
  return TABS.find((tab) => TAB_PATH[tab] === pathname) ?? null;
};

/** Whether `pathname` was pushed from the Library, over the tabs. */
export const inLibraryStack = (pathname: string): boolean => under(pathname, TAB_PATH.library);

/** The screens a list opens: one album, artist, genre, folder or playlist. */
export type DetailScreen = "album" | "artist" | "genre" | "folder" | "playlist";

/**
 * The path of detail screen `id`, opened from `from`: inside the shortcut tab
 * when opened from it (or from a screen already in it), otherwise on the
 * Library stack.
 */
export const detailPath = (from: string, screen: DetailScreen, id: number): string =>
  `${tabOfPath(from) === "shortcut" ? TAB_PATH.shortcut : TAB_PATH.library}/${screen}/${id}`;

/** Whether `pathname` is detail screen `id`, in either stack. */
export const isDetailPath = (pathname: string, screen: DetailScreen, id: number): boolean =>
  pathname === `${TAB_PATH.library}/${screen}/${id}` ||
  pathname === `${TAB_PATH.shortcut}/${screen}/${id}`;
