/**
 * Playlist rules: what a playlist may be called, what adding songs to one
 * does, how its items move, and which covers make its mosaic.
 */

import type { AlertSpec } from "./alert.ts";
import { foldAccentsAndCase } from "./library.ts";
import { catalogueOf, type AppLanguage } from "./localisation.ts";

export type PlaylistNameCheck =
  | { readonly ok: true; readonly name: string }
  | { readonly ok: false; readonly problem: "empty" | "taken" | "tooLong" };

/** The longest playlist name, in characters. */
export const PLAYLIST_NAME_MAX = 100;

const tidy = (name: string): string => name.trim().replace(/\s+/g, " ");

/**
 * Checks a playlist name the owner typed against the other playlists' names
 * (leave out the playlist being renamed). Returns the name as it should be stored.
 */
export const checkPlaylistName = (
  input: string,
  otherNames: readonly string[],
): PlaylistNameCheck => {
  const name = tidy(input);
  if (name === "") return { ok: false, problem: "empty" };
  if ([...name].length > PLAYLIST_NAME_MAX) return { ok: false, problem: "tooLong" };
  // Names that fold the same would be told apart only by case, accents or spacing.
  const folded = foldAccentsAndCase(name);
  if (otherNames.some((other) => foldAccentsAndCase(other) === folded))
    return { ok: false, problem: "taken" };
  return { ok: true, name };
};

/**
 * The name a new playlist starts with: New Playlist, then New Playlist 2, 3…,
 * in [language]. It's saved as written, so a later language change leaves it.
 */
export const nextPlaylistName = (names: readonly string[], language: AppLanguage = "en"): string => {
  const base = catalogueOf(language).playlists.defaultName;
  const taken = new Set(names.map(foldAccentsAndCase));
  if (!taken.has(foldAccentsAndCase(base))) return base;
  let n = 2;
  while (taken.has(foldAccentsAndCase(`${base} ${n}`))) n++;
  return `${base} ${n}`;
};

export interface PlaylistAdd<T> {
  /** The songs to append, in the order they were given. */
  readonly add: readonly T[];
  /** How many of the given songs the playlist already had. */
  readonly alreadyIn: number;
}

/**
 * What adding songs (a track, an album, an artist's songs) to a playlist does:
 * they go at the end, except those already in it, which are skipped rather than
 * doubled.
 */
export const planPlaylistAdd = <T>(
  existing: readonly T[],
  incoming: readonly T[],
): PlaylistAdd<T> => {
  const present = new Set(existing);
  const seen = new Set<T>();
  const add: T[] = [];
  let alreadyIn = 0;
  for (const id of incoming) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (present.has(id)) alreadyIn++;
    else add.push(id);
  }
  return { add, alreadyIn };
};

/** The confirmation shown once songs were added to a playlist. */
export const describePlaylistAdd = (
  playlist: string,
  added: number,
  alreadyIn: number,
  language: AppLanguage = "en",
): string => {
  const text = catalogueOf(language).playlists;
  if (added === 0) {
    if (alreadyIn === 0) return text.noSongsToAdd;
    return alreadyIn === 1 ? text.alreadyIn(playlist) : text.allAlreadyIn(alreadyIn, playlist);
  }
  const done = text.added(added, playlist);
  if (alreadyIn === 0) return done;
  return `${done} · ${text.someAlreadyIn(alreadyIn)}`;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** The order after the item at `from` is dragged to `to` (both 0-based). */
export const moveItem = <A>(items: readonly A[], from: number, to: number): A[] => {
  const next = [...items];
  if (from < 0 || from >= items.length) return next;
  const [item] = next.splice(from, 1) as [A];
  next.splice(clamp(to, 0, next.length), 0, item);
  return next;
};

const MOSAIC_TILES = 4;

/**
 * The covers a playlist's artwork is made of, from its songs' album covers in
 * playlist order (null for songs without one): the first four different
 * covers as a 2×2 mosaic, or the first cover alone when there are fewer than
 * four. Empty when there is nothing to show.
 */
export const playlistMosaic = <A>(covers: readonly (A | null)[]): readonly A[] => {
  const distinct: A[] = [];
  for (const cover of covers) {
    if (cover === null || distinct.includes(cover)) continue;
    distinct.push(cover);
    if (distinct.length === MOSAIC_TILES) return distinct;
  }
  return distinct.slice(0, 1);
};

/**
 * What a playlist's artwork shows: the image the owner gave it, alone, or
 * else its mosaic (`playlistMosaic`) of its songs' [covers].
 */
export const playlistArtwork = <A>(image: A | null, covers: readonly (A | null)[]): readonly A[] =>
  image === null ? playlistMosaic(covers) : [image];

/** One entry of a playlist: a song's place there (the same song may have several). */
export interface PlaylistPlace {
  readonly playlistId: number;
  readonly itemId: number;
}

/** What Remove from Playlist edits in one playlist. */
export interface PlaylistRemoval {
  readonly playlistId: number;
  readonly itemIds: readonly number[];
}

/**
 * Remove from Playlist on checked entries: exactly those entries (not every
 * copy of their songs), one edit per playlist, in the order first checked.
 */
export const playlistRemovals = (places: readonly PlaylistPlace[]): PlaylistRemoval[] => {
  const byPlaylist = new Map<number, number[]>();
  for (const { playlistId, itemId } of places) {
    const itemIds = byPlaylist.get(playlistId);
    if (itemIds === undefined) byPlaylist.set(playlistId, [itemId]);
    else itemIds.push(itemId);
  }
  return [...byPlaylist].map(([playlistId, itemIds]) => ({ playlistId, itemIds }));
};

/**
 * The alert that asks before deleting playlists, once however many: one is
 * named, several are counted. Their songs stay in the library.
 */
export const confirmPlaylistDeletion = (
  playlists: readonly { readonly name: string }[],
  language: AppLanguage = "en",
): AlertSpec & { readonly action: NonNullable<AlertSpec["action"]> } => {
  const text = catalogueOf(language).playlists;
  const only = playlists.length === 1 ? playlists[0] : undefined;
  return {
    title: only === undefined ? text.deleteMany(playlists.length) : text.deleteOne(only.name),
    message: only === undefined ? text.theirSongsStay : text.itsSongsStay,
    action: { label: text.delete, destructive: true },
  };
};
