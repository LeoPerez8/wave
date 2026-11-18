/** What a song's menu and the selection bar act on, and what their actions report back. */
import type { ActionSurface, ItemActionEntry, SongTagOutcome, TagLookupStop } from "@wave/core";
import type { BrowseScope } from "./browse.ts";

/** The most songs a target names one by one; Select All names the unchecked ones instead. */
export const MAX_TARGET_IDS = 10_000;

/**
 * The songs acted on, in [scope]'s list order: the ones named, or every song of the list
 * but the unchecked ones (Select All).
 */
export type SongTarget =
  | { readonly scope: BrowseScope; readonly ids: readonly number[] }
  | { readonly scope: BrowseScope; readonly all: true; readonly except: readonly number[] };

export type { ActionSurface };

/** The entries to show for a target (Core's `desktopSongActions`), with what they need. */
export interface SongMenu {
  readonly entries: readonly ItemActionEntry[];
  /** How many songs the target holds. */
  readonly count: number;
  /** The first song's title, for the menu's name and Remove from Library's question. */
  readonly title: string | null;
  /** The artists Go to Artist leads to, named. */
  readonly artists: readonly { readonly id: number; readonly name: string }[];
}

/** The entries main runs; the others open a page, a submenu or selection in the window. */
export const SONG_RUN_ACTIONS = [
  "playNext",
  "addToQueue",
  "favorite",
  "unfavorite",
  "addToPlaylist",
  "removeFromPlaylist",
  "removeFromLibrary",
  "fixSong",
  "fixSongs",
] as const;
export type SongRunAction = (typeof SONG_RUN_ACTIONS)[number];

/** What an action did, for its toast. */
export type SongRunResult =
  | { readonly kind: "queued"; readonly count: number }
  | { readonly kind: "favorite"; readonly on: boolean; readonly count: number }
  | {
      readonly kind: "playlist";
      readonly name: string;
      readonly added: number;
      readonly alreadyIn: number;
    }
  | { readonly kind: "removed"; readonly count: number }
  /** Songs taken out of the playlist the target lists; `playlists.undoRemove` puts them back. */
  | { readonly kind: "playlistRemoved"; readonly count: number }
  | ({ readonly kind: "fixed" } & FixSongsResult);

/** What Fix Songs came to, song by song, for Core's `tagLookupsToast`. */
export interface FixSongsResult {
  readonly results: readonly { readonly title: string; readonly outcome: SongTagOutcome }[];
  /** Songs left out as complete (Core's `songsToFix`). */
  readonly skipped: number;
  readonly stop?: TagLookupStop;
}
