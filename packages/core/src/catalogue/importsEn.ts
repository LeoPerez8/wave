import { formatNumber } from "../formatting.ts";
import { plural } from "../plural.ts";

const n = (count: number): string => formatNumber("en", count);

const songs = (count: number): string =>
  plural("en", count, { one: `${n(count)} song`, other: `${n(count)} songs` });

/** Importing playlists: links, Spotify and YT Music libraries, files, BlackPlayer stats. */
export const importsEn = {
  import: "Import",
  importDownload: "Import & Download",
  imported: "Imported",
  cancel: "Cancel",
  continue: "Continue",
  ok: "OK",
  show: "Show",
  dismiss: "Dismiss",
  tryAgain: "Try Again",
  reading: "Reading…",
  signInAgain: "Sign In Again",
  /** The Import card's sources. */
  fromLink: "From a Link",
  fromFiles: "From Files",
  fromYtMusic: "From YT Music",
  fromSpotify: "From Spotify",
  /** Importing from a link. */
  importFromLink: "Import from a link",
  playlistLink: "Playlist link",
  linkPlaceholder: "YouTube Music or Spotify playlist link",
  importPlaylist: "Import playlist",
  importFromYtMusic: "Import from YouTube Music",
  importFromSpotify: "Import from Spotify",
  couldntImportPlaylist: "Couldn't import the playlist",
  couldntImportPlaylists: "Couldn't import the playlists",
  pasteLink: "Paste a link to a YouTube Music or Spotify playlist.",
  otherSite: "Wave imports playlists from YouTube Music and Spotify links.",
  songLink: "This is a link to a song, not a playlist.",
  notPlaylistLink: "This link isn't to a playlist.",
  ytMusicOff: "YT Music is off",
  ytMusicOffMessage:
    "Turn on YT Music in Settings to import playlists from YouTube Music and Spotify links.",
  cantImport: "Can't import this",
  offline: "You're offline. Try again when you're back online.",
  playlistFailed:
    "Couldn't read this playlist. It may be private or deleted, or there was no answer online.",
  ytMusicOffInSettings: "YT Music is off in Settings.",
  playlistMissing: "This playlist doesn't exist or isn't public.",
  spotifyUnreachable: "Couldn't reach Spotify. Check your connection and try again.",
  spotifyFailed: "Couldn't read this playlist. Spotify didn't answer as expected.",
  readingPlaylist: "Reading the playlist…",
  noSongsToImport: "It has no songs to import.",
  songs,
  inLibrary: (count: number, total: number): string =>
    count === 0
      ? "none in your Library"
      : count === total
        ? "all in your Library"
        : `${n(count)} in your Library`,
  onService: (count: number, service: string): string => `${songs(count)} on ${service}`,
  listedTwiceGoInOnce: (count: number): string =>
    plural("en", count, {
      one: `${n(count)} listed twice goes in once`,
      other: `${n(count)} listed twice go in once`,
    }),
  notSongs: (count: number): string =>
    plural("en", count, { one: `${n(count)} isn't a song`, other: `${n(count)} aren't songs` }),
  truncated: (count: number): string => `It goes on past ${songs(count)}. Only those are imported.`,
  /** What a done import left out, on its playlist's page. */
  onlyFirst: (count: number, service: string): string =>
    `Only its first ${songs(count)} came from ${service}`,
  notFound: "Not found",
  listedTwice: "Listed twice",
  wereNotFound: (count: number): string =>
    plural("en", count, {
      one: `${n(count)} song wasn't found`,
      other: `${n(count)} songs weren't found`,
    }),
  wereListedTwice: (count: number): string =>
    plural("en", count, {
      one: `${n(count)} song was listed twice`,
      other: `${n(count)} songs were listed twice`,
    }),
  notFoundAndTwice: (missing: string, twice: number): string =>
    `${missing} · ${n(twice)} listed twice`,
  importedWithout: (name: string, count: number): string =>
    `${name} was imported without ${count === 1 ? "it" : "them"}.`,
  eachWentInOnce: (name: string): string => `Each went into ${name} once.`,
  importedWithoutBoth: (name: string): string =>
    `${name} was imported without the songs not found. Each song listed twice went in once.`,
  /** An importing playlist's progress. */
  waiting: "Waiting",
  waitingSongs: (count: number): string => `Waiting · ${songs(count)}`,
  readingCount: (done: string): string => `Reading ${done}`,
  readingOf: (done: string, total: string): string => `Reading ${done} of ${total}`,
  matching: "Matching with Library…",
  addingOf: (done: string, total: string): string => `Adding ${done} of ${total}`,
  importingPlaylists: (done: string, total: string): string =>
    `Importing playlists · ${done} of ${total}`,
  importPaused: (why: string): string => `Import paused · ${why}`,
  pausedOffline: "offline",
  pausedYtMusicOff: "YT Music off",
  pausedSignedOut: "signed out of Spotify",
  couldntReadOnline: "Couldn't read it online",
  /** From YT Music and From Spotify. */
  readingYtMusicLibrary: "Reading your YouTube Music library",
  readingSpotifyLibrary: "Reading your Spotify library",
  likedSongs: "Liked Songs",
  selectAll: "Select All",
  deselectAll: "Deselect All",
  alsoFavorites: "Also add to Favorites",
  ytLibraryFailed: "Couldn't read your YouTube Music library. No answer online.",
  ytSignedOut: "Your YouTube session ended. Sign in again to see your playlists.",
  spotifyLibraryFailed: "Couldn't read your Spotify library. No answer online.",
  spotifySignedOut: "Your Spotify session ended. Sign in again to see your playlists.",
  spotifyChanged: "Spotify changed something. Try again after updating Wave.",
  /** Playlists from files (M3U). */
  replaceTitle: (name: string): string => `Replace ${name}?`,
  replaceMessage: (name: string): string =>
    `You already have a playlist called ${name}. Replace its songs with the imported ones, or keep both playlists.`,
  replace: "Replace",
  keepBoth: "Keep Both",
  replaced: "Replaced",
  notInLibrary: (count: number): string => `${n(count)} not in your library`,
  listsNoSongs: "It lists no songs",
  noneInLibrary: (count: number): string =>
    plural("en", count, {
      one: `None of its ${songs(count)} is in your library`,
      other: `None of its ${songs(count)} are in your library`,
    }),
  notM3u: "Not an M3U playlist",
  couldntBeRead: "Couldn't be read",
  importedName: (name: string): string => `Imported ${name}`,
  nothingImported: "Nothing imported",
  importedPlaylists: (count: number): string =>
    plural("en", count, {
      one: `Imported ${n(count)} playlist`,
      other: `Imported ${n(count)} playlists`,
    }),
  /** BlackPlayer stats. */
  nothingNewImported: "Nothing new imported",
  importedBlackPlayer: "Imported BlackPlayer stats",
  newPlays: (count: number): string =>
    plural("en", count, { one: `${n(count)} new play`, other: `${n(count)} new plays` }),
  allPlaysKnown: "Every play in these files is in your history already",
  playsFrom: (songCount: number, snapshots: number): string =>
    `Of ${songs(songCount)}, from ${plural("en", snapshots, {
      one: `${n(snapshots)} snapshot`,
      other: `${n(snapshots)} snapshots`,
    })}`,
  songsNotInLibrary: (count: number): string => `${songs(count)} not in your library`,
  playsNotImported: (songCount: number, plays: number): string =>
    `${songCount === 1 ? "Its" : "Their"} ${plural("en", plays, {
      one: `${n(plays)} play wasn't`,
      other: `${n(plays)} plays weren't`,
    })} imported`,
  notBlackPlayer: "Not a BlackPlayer stats file",
  couldntImportBlackPlayer: "Couldn't import the BlackPlayer stats",
};
