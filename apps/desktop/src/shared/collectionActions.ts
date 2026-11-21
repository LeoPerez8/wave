import type { ActionSurface, CollectionKind, ItemActionEntry, PlayAction } from "@wave/core";
import type { SongRunResult, SongTarget } from "./songActions.ts";

/** A Library album, artist, genre or playlist, wherever the window shows it. */
export interface CollectionTarget {
  readonly kind: CollectionKind;
  readonly id: number;
}

export interface CollectionActionOptions {
  readonly here?: string;
  readonly selectable?: boolean;
  readonly surface?: ActionSurface;
}

export interface CollectionMenu {
  readonly entries: readonly ItemActionEntry[];
  readonly play: readonly PlayAction[];
  readonly artists: readonly { readonly id: number; readonly name: string }[];
}

export const COLLECTION_RUN_ACTIONS = [
  "playNext",
  "addToQueue",
  "addToPlaylist",
  "fixSongs",
] as const;
export type CollectionRunAction = (typeof COLLECTION_RUN_ACTIONS)[number];
export type CollectionRunResult = Extract<SongRunResult, { kind: "queued" | "playlist" | "fixed" }>;

/**
 * The checked rows of one kind's list: the ones named, or all but the unchecked (Select All), of
 * the rows its Find field [find] finds when it holds one.
 */
export type CollectionPick =
  | { readonly kind: CollectionKind; readonly ids: readonly number[] }
  | {
      readonly kind: CollectionKind;
      readonly all: true;
      readonly except: readonly number[];
      readonly find?: string;
    };

/** Songs and collections checked together: the songs first, then each kind's rows in list order. */
export interface SelectionTarget {
  readonly songs?: SongTarget | undefined;
  readonly collections: readonly CollectionPick[];
}

/** The selection bar's entries for a target (Core's `desktopSelectionActions`). */
export interface SelectionMenu {
  readonly entries: readonly ItemActionEntry[];
  /** How many items are checked. */
  readonly count: number;
}

export const SELECTION_RUN_ACTIONS = [...COLLECTION_RUN_ACTIONS, "download"] as const;
export type SelectionRunAction = (typeof SELECTION_RUN_ACTIONS)[number];
export type SelectionRunResult =
  CollectionRunResult | Extract<SongRunResult, { kind: "downloaded" }>;
