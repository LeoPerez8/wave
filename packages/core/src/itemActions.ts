/**
 * The actions Wave offers on library items, as one list shared by the
 * long-press menu (one item) and the selection bar (one or more checked
 * items), so a new menu entry shows up in selection too. Entries that only
 * make sense for a single target (Go to Album, Rename Playlist…) are offered
 * whenever the items still meet that condition.
 */

import { isDetailPath } from "./navigation.ts";

/**
 * What kind of library item the actions are about. `mixed` is items of
 * several kinds checked together (an artist page's albums and songs): they
 * get only the entries every kind offers.
 */
export type ItemKind =
  | "track"
  | "album"
  | "artist"
  | "playlist"
  | "genre"
  | "folder"
  | "section"
  | "mixed";

/** The kind of items checked together: theirs when they're all one kind, otherwise `mixed`. */
export const commonKind = (kinds: readonly Exclude<ItemKind, "mixed">[]): ItemKind => {
  const first = kinds[0];
  return first !== undefined && kinds.every((kind) => kind === first) ? first : "mixed";
};

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
  /** Settings allows looking songs up online: songs offer Find Lyrics and Genre. */
  readonly onlineLookups?: boolean | undefined;
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
  | "deletePlaylists"
  | "findLyricsAndGenre"
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
  deletePlaylists: "Delete Playlists",
  findLyricsAndGenre: "Find Lyrics and Genre",
  select: "Select",
  delete: "Delete",
};

/** Entries that delete something for good, shown in the destructive colour. */
export const isDestructiveAction = (action: ItemAction): boolean => action === "delete";

/**
 * Entries that ask before acting: selection mode stays until the question is
 * answered, so Cancel leaves the checked items as they were.
 */
export const confirmsFirst = (action: ItemAction): boolean =>
  action === "delete" || action === "deletePlaylist" || action === "deletePlaylists";

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
  if (kind === "playlist")
    entries.push(
      ...(items.length === 1
        ? [{ action: "renamePlaylist" } as const, { action: "deletePlaylist" } as const]
        : [{ action: "deletePlaylists" } as const]),
    );
  // Looks the songs up online and writes what it finds into their files.
  if (kind === "track" && subject.onlineLookups === true)
    entries.push({ action: "findLyricsAndGenre" });
  if (surface === "menu" && subject.selectable === true) entries.push({ action: "select" });
  // Last, and destructive: deletes the songs' files from the phone (after asking).
  if (kind === "track") entries.push({ action: "delete" });
  return entries;
};

/**
 * The entries a YT Music song's long-press menu offers: it can join the
 * queue beside the Library's songs. The Library's other entries (playlists,
 * favorites, Go to, Delete) are about its files, which a streamed song isn't.
 */
export const ytSongActions = (): ItemActionEntry[] => [
  { action: "playNext" },
  { action: "addToQueue" },
];

/**
 * What items are mostly selected for, and Delete (songs): always a button of
 * their own on the bar, never behind More.
 */
const KEPT_ON_BAR: ReadonlySet<ItemAction> = new Set<ItemAction>([
  "playNext",
  "addToQueue",
  "addToPlaylist",
  "favorite",
  "unfavorite",
  "removeFromPlaylist",
  "delete",
]);

/**
 * Shorter captions for labels too long for a bar button (whose accessibility
 * label stays the full one). "Unfavorite" is wider than a button of a
 * seven-button bar: its soft hyphen lets it break into two lines there.
 */
const BAR_LABELS: { readonly [A in ItemAction]?: string } = {
  unfavorite: "Un­favorite",
  removeFromPlaylist: "Remove",
};

/** A bar button's caption for [action]. */
export const actionBarLabel = (action: ItemAction): string =>
  BAR_LABELS[action] ?? ITEM_ACTION_LABELS[action];

/**
 * Fits entries into a bar of [slots] buttons: all of them when they fit,
 * otherwise a More button (the last slot) holding the rest. The primary
 * actions (queue, add to a playlist, favorite, remove from the playlist) and
 * Delete always keep a button, the bar growing past [slots] if they need it
 * (a playlist's songs: six, and More); other entries fill what's left before
 * More, in order.
 */
export const splitActionBar = <T extends { readonly action: ItemAction }>(
  entries: readonly T[],
  slots: number,
): { readonly bar: T[]; readonly more: T[] } => {
  if (entries.length <= slots) return { bar: [...entries], more: [] };
  const kept = entries.filter((entry) => KEPT_ON_BAR.has(entry.action)).length;
  let spare = Math.max(0, slots - 1 - kept);
  const bar: T[] = [];
  const more: T[] = [];
  for (const entry of entries) {
    if (KEPT_ON_BAR.has(entry.action)) bar.push(entry);
    else if (spare > 0) {
      bar.push(entry);
      spare -= 1;
    } else more.push(entry);
  }
  return { bar, more };
};
