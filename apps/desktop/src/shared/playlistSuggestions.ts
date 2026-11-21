/**
 * A playlist page's Recommended songs as the window sees them (`window.wave.playlistSuggestions`;
 * docs/spec.md, Playlist recommendations). Main holds the visit; the page reads its view while
 * it is open and closes it when it leaves.
 */
import type { PlaylistRefreshOutcome } from "@wave/core";

import type { Invoke } from "./bridge.ts";
import type { BrowseRow } from "./browse.ts";

/** One place in the section; a slot that has given up isn't listed. */
export type PlaylistSuggestionSlot =
  /** An offer, a Library song (its row's `id`) or a streamed one (its `videoId`). */
  | { readonly kind: "offer"; readonly key: string; readonly row: BrowseRow }
  /** Its Add or Dismiss is saving ([action] and [title]), or its next offer is loading. */
  | {
      readonly kind: "busy";
      readonly action: "add" | "dismiss" | null;
      readonly title: string | null;
    }
  /** The choice was saved and no other offer could be read: Try again reads one. */
  | { readonly kind: "unfilled" };

export type PlaylistSuggestionsView =
  /** YT Music is off: the section isn't shown and nothing is read. */
  | { readonly shown: false }
  | {
      readonly shown: true;
      readonly loading: boolean;
      readonly error: "load" | "save" | "refill" | null;
      readonly slots: readonly PlaylistSuggestionSlot[];
      /** The section has something to go to (Core's `goToSuggestionsOffered`). */
      readonly offered: boolean;
    };

export interface PlaylistSuggestionsContract {
  /**
   * Playlist [playlistId]'s suggestions, opening its visit the first time. [sources] changes
   * when the Library or the playlist changed: the visit renews behind its offers.
   */
  readonly "playlistSuggestions.view": {
    readonly args: readonly [playlistId: number, sources: string];
    readonly result: PlaylistSuggestionsView;
  };
  /** Adds offer [key] to the end of the playlist; false when it wasn't added. */
  readonly "playlistSuggestions.add": {
    readonly args: readonly [playlistId: number, key: string];
    readonly result: boolean;
  };
  /** Records that the owner doesn't want offer [key]; false when it wasn't saved. */
  readonly "playlistSuggestions.dismiss": {
    readonly args: readonly [playlistId: number, key: string];
    readonly result: boolean;
  };
  /** Swaps every offer showing for others; null when the visit is gone. */
  readonly "playlistSuggestions.refresh": {
    readonly args: readonly [playlistId: number];
    readonly result: PlaylistRefreshOutcome | null;
  };
  /** Try Again: after a failed read, asks afresh; with [refill], reads the slots left unfilled. */
  readonly "playlistSuggestions.retry": {
    readonly args: readonly [playlistId: number, refill: boolean];
    readonly result: void;
  };
  /** The page left: the reads under way stop. */
  readonly "playlistSuggestions.close": {
    readonly args: readonly [playlistId: number];
    readonly result: void;
  };
}

export const PLAYLIST_SUGGESTIONS_CALLS = [
  "playlistSuggestions.view",
  "playlistSuggestions.add",
  "playlistSuggestions.dismiss",
  "playlistSuggestions.refresh",
  "playlistSuggestions.retry",
  "playlistSuggestions.close",
] as const;

export const playlistSuggestionsBridge = (invoke: Invoke) => ({
  view: (playlistId: number, sources: string) =>
    invoke("playlistSuggestions.view", playlistId, sources),
  add: (playlistId: number, key: string) => invoke("playlistSuggestions.add", playlistId, key),
  dismiss: (playlistId: number, key: string) =>
    invoke("playlistSuggestions.dismiss", playlistId, key),
  refresh: (playlistId: number) => invoke("playlistSuggestions.refresh", playlistId),
  retry: (playlistId: number, refill: boolean) =>
    invoke("playlistSuggestions.retry", playlistId, refill),
  close: (playlistId: number) => invoke("playlistSuggestions.close", playlistId),
});
