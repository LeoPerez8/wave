/**
 * The actions Wave offers on library items, as one list shared by the
 * long-press menu (one item) and the selection bar (one or more checked
 * items), so a new menu entry shows up in selection too. Entries that only
 * make sense for a single target (Go to Album, Rename Playlist…) are offered
 * whenever the items still meet that condition.
 */

import { isDetailPath } from "./navigation.ts";

/** What kind of library item the actions are about. */
export type ItemKind = "track" | "album" | "artist" | "playlist" | "genre" | "folder" | "section";

/** Where the actions show: an item's long-press menu, or the bar of a list in selection mode. */
export type ActionSurface = "menu" | "selection";

/** What the actions need to know about each item; kinds fill in what applies to them. */
export interface ActionItem {
  /** The item's album (a track's). */
  readonly albumId?: number | undefined;
  /** The item's artist (a track's, an album's album artist). */
  readonly artistId?: number | undefined;
  /** A starred track. */
  readonly favorite?: boolean | undefined;
  /** A track shown in a playlist, which it can be removed from. */
  readonly inPlaylist?: boolean | undefined;
}

export interface ActionSubject {
  readonly kind: ItemKind;
  /** The items acted on: one for a menu, the checked ones (in list order) for the bar. */
  readonly items: readonly ActionItem[];
  /** Defaults to the menu. */
  readonly surface?: ActionSurface | undefined;
  /** The menu was opened from a list that can select: it offers Select. */
  readonly selectable?: boolean | undefined;
  /** The current route, so Go to doesn't lead to the page you're on. */
  readonly here: string;
}

export type ItemAction =
  | "playNext"
  | "addToQueue"
  | "addToPlaylist"
  | "favorite"
  | "unfavorite"
  | "removeFromPlaylist"
  | "goToAlbum"
  | "goToArtist"
  | "renamePlaylist"
  | "deletePlaylist"
  | "select"
  | "delete";

/** One entry, in the order shown; Go to entries carry where they lead. */
export type ItemActionEntry =
  | { readonly action: Exclude<ItemAction, "goToAlbum" | "goToArtist"> }
  | { readonly action: "goToAlbum"; readonly albumId: number }
  | { readonly action: "goToArtist"; readonly artistId: number };

/** What each entry says. */
export const ITEM_ACTION_LABELS: { readonly [A in ItemAction]: string } = {
  playNext: "Play Next",
  addToQueue: "Add to Queue",
  addToPlaylist: "Add to Playlist",
  favorite: "Favorite",
  unfavorite: "Remove from Favorites",
  removeFromPlaylist: "Remove from Playlist",
  goToAlbum: "Go to Album",
  goToArtist: "Go to Artist",
  renamePlaylist: "Rename Playlist",
  deletePlaylist: "Delete Playlist",
  select: "Select",
  delete: "Delete",
};

/** Entries that delete something for good, shown in the destructive colour. */
export const isDestructiveAction = (action: ItemAction): boolean => action === "delete";

/** The value every item has, or undefined when they differ or any lacks one. */
const shared = (values: readonly (number | undefined)[]): number | undefined => {
  const first = values[0];
  return first !== undefined && values.every((value) => value === first) ? first : undefined;
};

/** The entries to offer on [subject]'s items, in order. */
export const itemActions = (subject: ActionSubject): ItemActionEntry[] => {
  const { kind, items, here } = subject;
  if (items.length === 0) return [];
  const surface = subject.surface ?? "menu";
  const entries: ItemActionEntry[] = [
    { action: "playNext" },
    { action: "addToQueue" },
    { action: "addToPlaylist" },
  ];
  if (kind === "track") {
    entries.push({ action: items.every((item) => item.favorite) ? "unfavorite" : "favorite" });
    if (items.every((item) => item.inPlaylist)) entries.push({ action: "removeFromPlaylist" });
  }
  const albumId = shared(items.map((item) => item.albumId));
  if (albumId !== undefined && !isDetailPath(here, "album", albumId))
    entries.push({ action: "goToAlbum", albumId });
  const artistId = shared(items.map((item) => item.artistId));
  if (artistId !== undefined && !isDetailPath(here, "artist", artistId))
    entries.push({ action: "goToArtist", artistId });
  if (kind === "playlist" && items.length === 1)
    entries.push({ action: "renamePlaylist" }, { action: "deletePlaylist" });
  if (surface === "menu" && subject.selectable === true) entries.push({ action: "select" });
  // Last, and destructive: deletes the songs' files from the phone (after asking).
  if (kind === "track") entries.push({ action: "delete" });
  return entries;
};

/**
 * Fits entries into a bar of [slots] buttons: all of them when they fit,
 * otherwise the first ones and a More button (the last slot) holding the rest.
 */
export const splitActionBar = <T>(
  entries: readonly T[],
  slots: number,
): { readonly bar: T[]; readonly more: T[] } =>
  entries.length <= slots
    ? { bar: [...entries], more: [] }
    : { bar: entries.slice(0, slots - 1), more: entries.slice(slots - 1) };
