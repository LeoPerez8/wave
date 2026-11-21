/** What a song's menu and the selection bar act on, and what their actions report back. */
import type { ActionSurface, DesktopSongEntry, SongTagOutcome, TagLookupStop } from "@wave/core";
import type { BrowseScope } from "./browse.ts";

/** The ordinary array limit; large table selections use a packed vector of IDs. */
export const MAX_TARGET_IDS = 10_000;
export type SongIds = readonly number[] | Float64Array;

/**
 * The songs acted on, in [scope]'s list order: the ones named, or every song of the list
 * but the unchecked ones (Select All). A negative ID denotes a streamed playlist entry.
 */
export type SongTarget =
  | { readonly scope: BrowseScope; readonly ids: SongIds }
  | { readonly scope: BrowseScope; readonly all: true; readonly except: SongIds };

export type { ActionSurface };

/** The entries to show for a target (Core's `desktopSongActions`), with what they need. */
export interface SongMenu {
  readonly entries: readonly DesktopSongEntry[];
  /** How many songs the target holds. */
  readonly count: number;
  /** The first song's title, for the menu's name and Remove from Library's question. */
  readonly title: string | null;
  /** The artists Go to Artist leads to, named. */
  readonly artists: readonly { readonly id: number; readonly name: string }[];
}

/** The entries main runs; the others open a page, a submenu or selection in the window. */
export const SONG_RUN_ACTIONS = [
  "download",
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

/** What Show in Folder did: the file manager opened, the drive isn't connected, or no file. */
export type ShowInFolderResult = "shown" | "unavailable" | "gone";

/** What an action did, for its toast. */
export type SongRunResult =
  | { readonly kind: "downloaded"; readonly count: number }
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
