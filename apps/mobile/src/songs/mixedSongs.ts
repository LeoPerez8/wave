import type { MixedSong, RowMenuAction, SongRowState } from "@wave/core";

import type { SongRow } from "@/library/LibraryStore";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { openTrackActions, type MenuOptions } from "@/playback/ActionsMenu";
import type { RowSwipeOptions } from "@/playback/rowSwipe";
import { runTrackSwipe } from "@/playback/rowSwipe";
import { openYtSongActions, runYtSongSwipe } from "@/ytmusic/YtSongActions";

import type { SongListSelection } from "./useSongRows";
import { librarySongEntry, type SongListEntry } from "./songListSources";

/**
 * A list mixing the Library's songs and YT Music's (a YT Music album,
 * playlist or mix, an artist's page, Search, a ranking): one row source, menu
 * and swipe for either kind.
 */
export type ListedSong = MixedSong<NativeYtSong, SongRow>;

/** [song]'s row: the Library's song as the Library shows it, else YT Music's. */
export const mixedSongEntry = (
  song: ListedSong,
  state?: SongRowState,
  gated = false,
): SongListEntry =>
  song.source === "library"
    ? librarySongEntry(song.track, state)
    : { source: { kind: "ytMusic", song: song.song }, state, gated };

/** [song]'s long-press menu, the Library's or YT Music's. */
export const openMixedSongActions = (song: ListedSong, options: MenuOptions = {}): void => {
  if (song.source === "library") openTrackActions(song.track, options);
  else openYtSongActions(song.song, options);
};

/** Runs the swipe [song]'s row showed ([shown]), as its menu would. */
export const runMixedSongSwipe = (
  song: ListedSong,
  shown: RowMenuAction,
  options: RowSwipeOptions = {},
): void => {
  if (song.source === "library")
    runTrackSwipe(
      { kind: "track", items: [{ song: song.track, playlistItem: options.playlistItem }] },
      shown,
    );
  else runYtSongSwipe(song.song, shown, options);
};

/** A page item that may be one of its songs (an artist's page mixes songs with headings and shelves). */
type PageItem = { readonly type: string; readonly song?: ListedSong };

/** A mixed page's song-list menu and swipe: its song items act as [openMixedSongActions] and [runMixedSongSwipe]. */
export const mixedPageSongHandlers = {
  onMenu: (item: PageItem, options?: MenuOptions): void => {
    if (item.type === "song" && item.song) openMixedSongActions(item.song, options);
  },
  onSongSwipe: (item: PageItem, shown: RowMenuAction): void => {
    if (item.type === "song" && item.song) runMixedSongSwipe(item.song, shown);
  },
} as const;

interface Selecting<U> {
  readonly selecting: boolean;
  readonly isChecked: (item: U) => boolean;
  readonly toggle: (item: U) => void;
  readonly start: (item: U) => void;
}

/**
 * A screen's one selection as its song list sees it: each list item checks
 * as what [of] makes of it, and an item [of] gives nothing for (a heading)
 * never checks.
 */
export const songSelection = <T, U>(
  selection: Selecting<U>,
  of: (item: T) => U | null,
): SongListSelection<T> => ({
  selecting: selection.selecting,
  isChecked: (item) => {
    const selected = of(item);
    return selected !== null && selection.isChecked(selected);
  },
  toggle: (item) => {
    const selected = of(item);
    if (selected !== null) selection.toggle(selected);
  },
  start: (item) => {
    const selected = of(item);
    if (selected !== null) selection.start(selected);
  },
});
