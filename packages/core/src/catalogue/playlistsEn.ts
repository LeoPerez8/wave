import { formatNumber } from "../formatting.ts";
import { plural } from "../plural.ts";

const n = (count: number): string => formatNumber("en", count);

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const songs = (count: number): string =>
  plural("en", count, { one: `${n(count)} song`, other: `${n(count)} songs` });

/** Playlists: their list, pages, sheets, editing, sort and layout, and recommendations. */
export const playlistsEn = {
  releaseNoticeTitle: "Find release dates",
  releaseNotice:
    "Wave sends song titles and artists to Deezer, then recording ISRCs to MusicBrainz to find first release dates. This runs automatically according to Search online while YT Music is on, for Library songs and YT Music songs in playlists. Sorting a playlist by Release date also looks up its songs. Found first release dates are saved to the Library and to files without an original date.",
  releaseProgress: (done: number, total: number): string =>
    `Finding release dates: ${n(done)} of ${n(total)}`,
  releaseOffline: "Release date lookup paused: offline or service unavailable",
  releaseOldest: "Release date · Oldest first",
  releaseNewest: "Release date · Newest first",
  /** A release date as precise as it's known (Core's `formatReleaseDate`): 1985, June 1985, June 21, 1985. */
  releaseDate: (year: number, month: number | null, day: number | null): string =>
    month === null
      ? String(year)
      : day === null
        ? `${MONTHS[month - 1]} ${year}`
        : `${MONTHS[month - 1]} ${day}, ${year}`,
  /** The Release date screen, where the owner types when a song first came out. */
  releaseDateTitle: "Release date",
  releaseDateYear: "Year",
  releaseDateMonth: "Month",
  releaseDateDay: "Day",
  releaseDateHint: "The year alone, or with the month, or the full date.",
  releaseDateImpossible: "That date doesn't exist, or hasn't come yet.",
  releaseDateSave: "Save",
  releaseDateClear: "Clear",
  releaseDateFull: "Wave can't keep more typed release dates.",
  sortsFull: "Wave can't keep this playlist's sort on your Wave account.",
  releaseDateCouldntSave: "Couldn't save the release date.",
  releaseDateNotInFile: "Saved in Wave, but the song's file couldn't take the date.",
  /** A new playlist's name, saved as written: New Playlist, then New Playlist 2, 3… */
  defaultName: "New Playlist",
  newPlaylist: "New Playlist",
  newPlaylistTitle: "New playlist",
  create: "Create",
  renamePlaylist: "Rename playlist",
  rename: "Rename",
  playlistName: "Playlist name",
  cancel: "Cancel",
  nameEmpty: "Give the playlist a name.",
  nameTaken: "Another playlist already has this name.",
  nameTooLong: "Names can be up to 100 characters.",
  addToPlaylist: "Add to playlist",
  created: (name: string): string => `Created ${name}`,
  /** Toasts when an edit fails. */
  couldntList: "Couldn't list the playlists",
  couldntAdd: "Couldn't add to the playlist",
  couldntCreate: "Couldn't create the playlist",
  couldntRename: "Couldn't rename the playlist",
  couldntChangeImage: "Couldn't change the image",
  couldntAdjustImage: "Couldn't adjust the image",
  couldntRemoveImage: "Couldn't remove the image",
  couldntDelete: (count: number): string =>
    count === 1 ? "Couldn't delete the playlist" : "Couldn't delete the playlists",
  playlistActions: "Playlist actions",
  noSongsYet: "No songs yet",
  addSongsHint: "Long-press a song, an album or an artist and choose Add to Playlist.",
  deleted: "It was deleted.",
  noPlaylists: "No playlists",
  playlistCount: (count: number): string =>
    plural("en", count, { one: `${n(count)} playlist`, other: `${n(count)} playlists` }),
  importPlaylists: "Import Playlists",
  moveUp: "Move up",
  moveDown: "Move down",
  removed: (count: number): string =>
    plural("en", count, {
      one: "Song removed from playlist",
      other: `${n(count)} songs removed from playlist`,
    }),
  undo: "Undo",
  couldntRestore: "Couldn't restore the songs",
  /** "2,451 songs · 3 unavailable" under a playlist's name. */
  songs,
  unavailable: (count: number): string => `${n(count)} unavailable`,
  /** What adding songs to a playlist says. */
  noSongsToAdd: "No songs to add",
  alreadyIn: (playlist: string): string => `Already in ${playlist}`,
  allAlreadyIn: (count: number, playlist: string): string =>
    `All ${n(count)} songs are already in ${playlist}`,
  added: (count: number, playlist: string): string => `Added ${songs(count)} to ${playlist}`,
  someAlreadyIn: (count: number): string =>
    plural("en", count, {
      one: `${n(count)} was already in it`,
      other: `${n(count)} were already in it`,
    }),
  /** Asking before deleting playlists. */
  deleteOne: (name: string): string => `Delete ${name}?`,
  deleteMany: (count: number): string => `Delete ${n(count)} playlists?`,
  itsSongsStay: "Its songs stay in your library.",
  theirSongsStay: "Their songs stay in your library.",
  delete: "Delete",
  /** How the Playlists list shows and orders them (its title's long press, Settings › Layout). */
  showAs: "Show playlists as",
  chooseLayout: "Choose how playlists show",
  showAndSort: "Show and sort playlists",
  layouts: { list: "List", grid: "Grid", large: "Large Cards" },
  sortBy: "Sort by",
  sorts: { name: "Name", added: "Recently Added", played: "Recently Played", custom: "Custom" },
  /** The floating pill that takes a long playlist to its suggestions. */
  goToSuggestions: "Go to Suggestions",
  /** Recommended songs under a playlist. */
  recommendedSongs: "Recommended songs",
  loading: "Loading…",
  loadingRecommended: "Loading recommended songs",
  loadingAnother: "Loading another recommendation",
  tryAgain: "Try Again",
  addRecommendation: (title: string): string => `Add ${title} to playlist`,
  dismissRecommendation: (title: string): string => `Dismiss ${title} recommendation`,
  adding: (title: string): string => `Adding ${title}`,
  dismissing: (title: string): string => `Dismissing ${title}`,
  addedSong: (title: string): string => `Added ${title} to the playlist.`,
  dismissedSong: (title: string): string => `Dismissed ${title}.`,
  couldntAddSong: (title: string): string => `Couldn’t add ${title}. Try again.`,
  couldntDismissSong: (title: string): string => `Couldn’t dismiss ${title}. Try again.`,
  next: (title: string): string => `Next recommendation: ${title}.`,
  couldntLoadAnother: "Couldn’t load another recommendation.",
  noMoreMatching: "No more matching songs right now.",
  recommendationsUpdated: "Recommendations updated.",
  savedButNoAnother: "Your choice was saved. Couldn’t load another recommendation.",
  couldntSaveChoice: "Couldn’t save your choice. Try the song’s action again.",
  couldntLoadRecommendations: "Couldn’t load recommendations. Try again.",
  addSongsForRecommendations: "Add songs to get recommendations for this playlist.",
};
