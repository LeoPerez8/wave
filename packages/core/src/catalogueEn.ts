import { desktopShortcutsEn } from "./catalogue/desktopShortcutsEn.ts";
import { desktopWindowEn } from "./catalogue/desktopWindowEn.ts";
import { desktopOutputEn } from "./catalogue/desktopOutputEn.ts";
import { libraryEn } from "./catalogue/libraryEn.ts";
import { playlistsEn } from "./catalogue/playlistsEn.ts";
import { importsEn } from "./catalogue/importsEn.ts";
import { homeEn } from "./catalogue/homeEn.ts";
import { arrangementEn } from "./catalogue/arrangementEn.ts";
import { discoverEn } from "./catalogue/discoverEn.ts";
import { djEn } from "./catalogue/djEn.ts";
import { statsEn } from "./catalogue/statsEn.ts";
import { recapEn } from "./catalogue/recapEn.ts";
import { listeningHistoryEn } from "./catalogue/listeningHistoryEn.ts";
import { collaborativePageEn } from "./catalogue/collaborativePageEn.ts";
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
import { collaborativeMenuEn } from "./catalogue/collaborativeMenuEn.ts";
import { songDeletionEn } from "./catalogue/songDeletionEn.ts";
import { appUpdatesEn } from "./catalogue/appUpdatesEn.ts";
import { inviteJoinEn } from "./catalogue/inviteJoinEn.ts";
import { whatsNewEn } from "./catalogue/whatsNewEn.ts";
import { versionHistoryEn } from "./catalogue/versionHistoryEn.ts";
/**
 * Wave's interface text in English: the shape every other catalogue must fill
 * (`Catalogue`), so a phrase missing from one fails the type check. Group
 * entries by area. An entry is a string, or a small function when it takes a
 * value or a count (`plural`). Log text and internal errors stay out.
 */

import type { TabBarTab } from "./tabBar.ts";

export const en = {
  desktopWindow: desktopWindowEn,
  desktopOutput: desktopOutputEn,
  desktopLayout: {
    language: "Language",
    // Each language under its own name, so it can be found from the other one.
    languages: { system: "System", en: "English", "pt-BR": "Português (Brasil)" },
    brand: "Wave",
    home: "Home",
    search: "Search",
    library: "Library",
    playlists: "Playlists",
    artists: "Artists",
    albums: "Albums",
    songs: "Songs",
    genres: "Genres",
    favorites: "Favorites",
    settings: "Settings",
    back: "Back",
    forward: "Forward",
    newPlaylist: "New Playlist",
    time: "Time",
    favorite: "Favorite",
    play: "Play",
    pause: "Pause",
    shuffle: "Shuffle",
    previous: "Previous",
    next: "Next",
    repeat: "Repeat",
    repeatOff: "Repeat off",
    repeatAll: "Repeat all",
    repeatOne: "Repeat one",
    lyrics: "Lyrics",
    queue: "Queue",
    volume: "Volume",
    mute: "Mute",
    unmute: "Unmute",
    seek: "Playback position",
    sleep: "Sleep timer",
    menu: "Song menu",
    player: "Player bar",
    nothingPlaying: "Choose a song to play",
    noResults: "No songs found.",
    loading: "Loading…",
    unavailableSection: "This section will be available in a later update.",
    window: "Window",
    playback: "Playback",
    lyricsAndTags: "Lyrics and tags",
    downloads: "Downloads",
    accounts: "Accounts",
    versionHistory: "Version History",
    album: "Album",
    artist: "Artist",
    playlist: "Playlist",
    genre: "Genre",
    minutes: (n: number) => `${n} min`,
    jump: "Jump to a letter",
    open: "Open",
    songCount: (n: number) => `${n.toLocaleString("en-US")} ${n === 1 ? "song" : "songs"}`,
    ytMusic: "YT Music",
    discover: "Discover",
    magicQueue: "Magic Queue",
    youTubeMusic: "YouTube Music",
    ytOffline: "YouTube Music comes back when you're online.",
    ytFailed: "YouTube Music didn't answer. Try again in a moment.",
    /** The sidebar's Downloads entry while a run is on its way. */
    downloadsProgress: (percent: number) => `Downloads, ${percent}% done`,
    nothingDownloading: "Songs you download show here until they're in the Library.",
    downloadsOffline: "Downloads pause while you're offline and go on once you're back.",
    downloadsFolder: "Downloads go to",
    changeFolder: "Change Folder",
    similarArtists: "Similar artists",
    youMightAlsoLike: "You might also like",
    magicQueueIdle: "Start a Magic Queue from one of these songs, or from any song's menu.",
    sidePanel: "Side panel",
    closeSidePanel: "Close side panel",
    removeFromQueue: (title: string) => `Remove “${title}” from the Queue`,
  },
  desktopLibrary: {
    refresh: "Refresh",
    refreshKey: "F5",
    unavailableFolder: "Unavailable folder",
    driveDisconnected: "The drive isn't connected. Reconnect it and try again.",
    actionFailed: "Couldn't complete that action. Try again.",
    /** Release Date's dialog: the date the song has ([date], `formatReleaseDate`'s), or none. */
    releaseDateKnown: (date: string) => `Released ${date}`,
    releaseDateUnknown: "No release date is known.",
    /** A song menu's Show in Folder (Core's `desktopSongActions`), and its song's file gone. */
    showInFolder: "Show in Folder",
    fileGone: "The song's file isn't there anymore. Refresh the Library to find it again.",
    downloadStarted: (count: number) =>
      count === 1 ? "Download started" : `Downloading ${count} songs`,
    downloading: (title: string) => `Downloading ${title}`,
    /** Play or Shuffle on a list none of whose songs can play here (Core's `listPlay`). */
    nothingToPlay: "None of these songs are on this computer yet. Download them to play them here.",
    /** Play or Shuffle left out [count] missing songs it couldn't stream. */
    leftOut: (count: number) =>
      count === 1
        ? "1 song isn't on this computer, so it was left out."
        : `${count} songs aren't on this computer, so they were left out.`,
    fileFailed: "Couldn't play this file",
    titleColumn: "Title",
    artistColumn: "Artist",
    albumColumn: "Album",
    /** The column of a playlist's own order and of an artist's Popular ranks. */
    orderColumn: "#",
    releaseDateColumn: "Release date",
    previous: "Previous page",
    next: "Next page",
    page: (first: number, last: number, total: number) => `${first}–${last} of ${total}`,
    songMenu: (title: string) => `Actions for “${title}”`,
    chooseArtist: "Choose an Artist",
    noPlaylists: "No playlists yet",
    /** Its menu, where the edits would be: the desktop shows and plays it and edits none of it. */
    collaborativeOnPhone: "Edit collaborative playlists in Wave on your phone",
    checkSong: (title: string) => `Select “${title}”`,
    /** An artist page's songs from YouTube Music, a page at a time. */
    showMoreSongs: "Show more songs",
  },
  /** The desktop's Wave account: what the phone's Settings › Accounts has no need to say. */
  desktopAccount: {
    finishInBrowser: "Finish signing in in your browser.",
    keyringMissing:
      "This computer has no keyring, so the session lasts until Wave quits. Sign in again next time.",
    browserTitle: "Back to Wave",
    browserMessage: "You can close this tab. Wave finishes signing in.",
    /** Delete Account's fresh Google sign-in: while the browser has it, and the tab once it's done. */
    confirmDeletionInBrowser: "Sign in to Google in your browser to confirm it's you.",
    browserDeletionMessage: "You can close this tab. Wave finishes deleting the account.",
    /** The request went to Wave's server: there is no Cancel any more. */
    deletionSent: "Wave is deleting the account. It can't be cancelled now.",
    closeBrowserWhenDone:
      "Sign in in the browser window that opened, then close it. Wave picks up the session once the window is closed.",
    noBrowser:
      "Signing in to YouTube needs Chrome, Edge, Brave or Chromium on this computer. Install one and try again.",
    spotifyUnavailable: "Spotify sign-in isn't set up in this build of Wave.",
    spotifyNote:
      "Signing in lets Wave read your Spotify playlists and share your Wave playlists there.",
  },
  desktopShortcuts: desktopShortcutsEn,
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
  dj: djEn,
  stats: statsEn,
  recap: recapEn,
  listeningHistory: listeningHistoryEn,
  share: shareEn,
  /** The page an invite link opens in a browser (the sync service's `GET /invite`): nothing of the playlist. */
  invitePage: {
    title: "Wave invite",
    heading: "This is a Wave invite",
    body: "Open this link on your phone with an up-to-date Wave.",
  },
  collaborativePage: collaborativePageEn,
  /** Opening an invite link in Wave: the join screen and why it can't join. */
  inviteJoin: inviteJoinEn,
  settings: settingsEn,
  downloadStatus: downloadStatusEn,
  alert: alertEn,
  fixSongs: fixSongsEn,
  downloads: downloadsEn,
  itemActions: itemActionsEn,
  collaborativeMenu: collaborativeMenuEn,
  songDeletion: songDeletionEn,
  whatsNew: whatsNewEn,
  versionHistory: versionHistoryEn,
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
    /** TalkBack's name for the section header's Play, with the section's title. */
    playSection: (title: string) => `Play ${title}`,
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
