import { libraryEn } from "./catalogue/libraryEn.ts";
import { playlistsEn } from "./catalogue/playlistsEn.ts";
import { importsEn } from "./catalogue/importsEn.ts";
import { homeEn } from "./catalogue/homeEn.ts";
import { arrangementEn } from "./catalogue/arrangementEn.ts";
import { discoverEn } from "./catalogue/discoverEn.ts";
import { statsEn } from "./catalogue/statsEn.ts";
import { recapEn } from "./catalogue/recapEn.ts";
import { listeningHistoryEn } from "./catalogue/listeningHistoryEn.ts";
import { shareEn } from "./catalogue/shareEn.ts";
import { downloadNoticeEn } from "./catalogue/downloadNoticeEn.ts";
import { nativeEn } from "./catalogue/nativeEn.ts";
import { autoEn } from "./catalogue/autoEn.ts";
import { playbackTextEn } from "./catalogue/playbackTextEn.ts";
import { lyricsLanguagesEn } from "./catalogue/lyricsLanguagesEn.ts";
import { showsEn } from "./catalogue/showsEn.ts";
import { upcomingShowsEn } from "./catalogue/upcomingShowsEn.ts";
import { settingsEn } from "./catalogue/settingsEn.ts";
import { downloadStatusEn } from "./catalogue/downloadStatusEn.ts";
import { alertEn } from "./catalogue/alertEn.ts";
import { fixSongsEn } from "./catalogue/fixSongsEn.ts";
import { downloadsEn } from "./catalogue/downloadsEn.ts";
import { itemActionsEn } from "./catalogue/itemActionsEn.ts";
import { songDeletionEn } from "./catalogue/songDeletionEn.ts";
import { appUpdatesEn } from "./catalogue/appUpdatesEn.ts";
import { whatsNewEn } from "./catalogue/whatsNewEn.ts";
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
  library: libraryEn,
  playlists: playlistsEn,
  imports: importsEn,
  lyricsLanguages: lyricsLanguagesEn,
  playbackText: playbackTextEn,
  recognizeTile: {
    tryAgain: playbackTextEn.tryAgain,
    useMicrophone: playbackTextEn.useMicrophone,
  },
  shows: showsEn,
  upcomingShows: upcomingShowsEn,
  home: homeEn,
  arrangement: arrangementEn,
  discover: discoverEn,
  stats: statsEn,
  recap: recapEn,
  listeningHistory: listeningHistoryEn,
  share: shareEn,
  settings: settingsEn,
  downloadStatus: downloadStatusEn,
  alert: alertEn,
  fixSongs: fixSongsEn,
  downloads: downloadsEn,
  itemActions: itemActionsEn,
  songDeletion: songDeletionEn,
  whatsNew: whatsNewEn,
  appUpdates: appUpdatesEn,
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
    ytMusicOff: "YT Music is off in Settings",
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
