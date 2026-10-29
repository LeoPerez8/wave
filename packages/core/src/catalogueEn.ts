import { downloadNoticeEn } from "./catalogue/downloadNoticeEn.ts";
import { nativeEn } from "./catalogue/nativeEn.ts";
import { autoEn } from "./catalogue/autoEn.ts";
import { settingsEn } from "./catalogue/settingsEn.ts";
import { downloadStatusEn } from "./catalogue/downloadStatusEn.ts";
import { alertEn } from "./catalogue/alertEn.ts";
import { fixSongsEn } from "./catalogue/fixSongsEn.ts";
/**
 * Wave's interface text in English: the shape every other catalogue must fill
 * (`Catalogue`), so a phrase missing from one fails the type check. Group
 * entries by area. An entry is a string, or a small function when it takes a
 * value or a count (`plural`). Log text and internal errors stay out.
 */

import type { TabBarTab } from "./tabBar.ts";

export const en = {
  downloadNotice: downloadNoticeEn,
  native: nativeEn,
  auto: autoEn,
  settings: settingsEn,
  downloadStatus: downloadStatusEn,
  alert: alertEn,
  fixSongs: fixSongsEn,
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
  newReleases: {
    title: "New from Artists You Follow",
    single: "Single",
    ep: "EP",
    album: "Album",
    unavailable: "Not on YouTube Music yet",
    noAnswer: "No answer online. Try again in a moment.",
    hideFailed: "Couldn't hide this release. Try again.",
    hide: "Hide",
    goToArtist: "Go to Artist",
    addToPlaylist: "Add to Playlist",
    today: "Today",
    yesterday: "Yesterday",
    daysAgo: (days: number) => `${days} days ago`,
    absoluteDate: (month: number, day: number, year: number | null) =>
      `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][month - 1]} ${day}${year === null ? "" : `, ${year}`}`,
  },
  followArtistSearch: {
    placeholder: "Find artists to follow",
    follow: "Follow",
    following: "Following",
    searching: "Searching Deezer…",
    unavailable: "Couldn't reach Deezer. Library results are still available.",
    empty: "No artists found.",
  },
  tabBar: {
    /** TalkBack's hint on every tab. */
    editHint: "Long press to edit the tab bar",
    /** TalkBack's action on every tab. */
    edit: "Edit the tab bar",
  },
};

/** Every piece of interface text, as English lays it out. */
export type Catalogue = typeof en;
