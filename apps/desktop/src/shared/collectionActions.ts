import type { ActionSurface, CollectionKind, ItemActionEntry, PlayAction } from "@wave/core";
import type { SongRunResult } from "./songActions.ts";

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
