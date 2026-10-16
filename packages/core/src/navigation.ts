/**
 * Where screens live. The tabs are Home, Library, Search and the Library's
 * sections, each a tab of its own (the owner picks which the bar shows, see
 * `tabBar.ts`). Screens opened from the Library are pushed over the tabs
 * (they keep the mini player, not the tab bar); screens opened from a section
 * tab stay inside it, under the tab bar, so switching away and back keeps
 * your place.
 */
import { LIBRARY_SECTION_SLUGS, type LibrarySectionSlug } from "./librarySections.ts";
import type { TabBarTab } from "./tabBar.ts";

/** Each tab's own screen. */
export const TAB_PATH = {
  index: "/",
  library: "/library",
  search: "/search",
  playlists: "/playlists",
  artists: "/artists",
  albums: "/albums",
  songs: "/songs",
  genres: "/genres",
  favorites: "/favorites",
} as const satisfies Record<TabBarTab, string>;

const TABS = Object.keys(TAB_PATH) as TabBarTab[];

const under = (pathname: string, root: string): boolean => pathname.startsWith(`${root}/`);

/** The section tab `pathname` is drawn in, its own screen or one opened inside it. */
const sectionTabOf = (pathname: string): LibrarySectionSlug | undefined =>
  LIBRARY_SECTION_SLUGS.find(
    (section) => pathname === TAB_PATH[section] || under(pathname, TAB_PATH[section]),
  );

/** The tab `pathname` is drawn in (under the tab bar), or null for a screen pushed over the tabs. */
export const tabOfPath = (pathname: string): TabBarTab | null =>
  sectionTabOf(pathname) ?? TABS.find((tab) => TAB_PATH[tab] === pathname) ?? null;

/** Whether `pathname` was pushed from the Library, over the tabs. */
export const inLibraryStack = (pathname: string): boolean => under(pathname, TAB_PATH.library);

/** The screens a list opens: one album, artist, genre or playlist. */
export type DetailScreen = "album" | "artist" | "genre" | "playlist";

/**
 * The path of detail screen `id`, opened from `from`: inside the section tab
 * it was opened from (or from a screen already in it), otherwise on the
 * Library stack.
 */
export const detailPath = (from: string, screen: DetailScreen, id: number): string =>
  `${TAB_PATH[sectionTabOf(from) ?? "library"]}/${screen}/${id}`;

/** Whether `pathname` is detail screen `id`, on the Library stack or in a section tab. */
export const isDetailPath = (pathname: string, screen: DetailScreen, id: number): boolean =>
  (["library", ...LIBRARY_SECTION_SLUGS] as const).some(
    (stack) => pathname === `${TAB_PATH[stack]}/${screen}/${id}`,
  );
