/**
 * Wave's interface text in English: the shape every other catalogue must fill
 * (`Catalogue`), so a phrase missing from one fails the type check. Group
 * entries by area. An entry is a string, or a small function when it takes a
 * value or a count (`plural`). Log text and internal errors stay out.
 */

import type { TabBarTab } from "./tabBar.ts";

export const en = {
  /** Each tab's name, in the tab bar, its editor and TalkBack. */
  tabs: {
    index: "Home",
    library: "Library",
    search: "Search",
    playlists: "Playlists",
    artists: "Artists",
    albums: "Albums",
    songs: "Songs",
    genres: "Genres",
    favorites: "Favorites",
  } satisfies Record<TabBarTab, string>,
  tabBar: {
    /** TalkBack's hint on every tab. */
    editHint: "Long press to edit the tab bar",
    /** TalkBack's action on every tab. */
    edit: "Edit the tab bar",
  },
};

/** Every piece of interface text, as English lays it out. */
export type Catalogue = typeof en;
