import type { ItemAction } from "../itemActions.ts";
import type { PlayAction } from "../menuLayout.ts";
import { playbackTextEn } from "./playbackTextEn.ts";

/** Long-press menus, selection bars and swipe actions (`itemActions`, `menuLayout`, `swipeActions`). */
export const itemActionsEn = {
  /** What each menu entry says, by `ItemAction`. */
  labels: {
    playNext: "Play Next",
    addToQueue: "Add to Queue",
    magicQueue: "Magic Queue",
    addToPlaylist: "Add to Playlist",
    favorite: "Favorite",
    unfavorite: "Remove from Favorites",
    removeFromPlaylist: "Remove from Playlist",
    goToAlbum: "Go to Album",
    goToArtist: "Go to Artist",
    renamePlaylist: "Rename Playlist",
    changeImage: "Change Image",
    adjustImage: "Adjust Image",
    removeImage: "Remove Image",
    share: "Share",
    releaseDate: "Release Date",
    deletePlaylist: "Delete Playlist",
    deletePlaylists: "Delete Playlists",
    fixSong: "Fix Song",
    fixSongs: "Fix Songs",
    select: "Select",
    delete: "Delete",
    removeFromLibrary: "Remove from Library",
    download: "Download",
    cancelDownload: "Cancel Download",
    retryDownload: "Retry Download",
    downloadMissingSongs: "Download Missing Songs",
    retryFailed: "Retry Failed",
    sleepTimer: "Sleep Timer",
    // The playing song's card opens Now Playing's Related view, named as its slot is.
    related: playbackTextEn.related,
  } satisfies Record<ItemAction, string>,
  /**
   * Shorter captions for a bar button. "Unfavorite" is wider than a button of
   * a seven-button bar: its soft hyphen lets it break into two lines there.
   */
  barLabels: {
    unfavorite: "Un­favorite",
    removeFromPlaylist: "Remove",
    downloadMissingSongs: "Download",
  } satisfies Partial<Record<ItemAction, string>>,
  /** The play actions, on a menu's cards and its Shuffle row. */
  playLabels: {
    play: "Play",
    playNext: "Play Next",
    addToQueue: "Add to Queue",
    shuffle: "Shuffle",
  } satisfies Record<PlayAction, string>,
  /** Settings › Swipe actions' name for a row's way out (Remove from Playlist, Delete…). */
  remove: "Remove",
  /** Release Date's menu entry for a song with a date ([date], `formatReleaseDate`'s). */
  releaseDateIs: (date: string): string => `Release Date · ${date}`,
  /** The playing song's card's Sleep Timer entry while a timer runs ([left]: `14:59`, End of track). */
  sleepTimerIs: (left: string): string => `Sleep Timer · ${left}`,
  /** A song's star toggled from a swipe, a menu or the selection bar. */
  addedToFavorites: "Added to Favorites",
  addedSongsToFavorites: (count: number): string => `Added ${count} songs to Favorites`,
};
