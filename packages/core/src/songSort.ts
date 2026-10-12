/**
 * The orders a song list can be sorted in (Library › Songs, and the other song
 * lists that offer the same control): by song name, artist, album or date
 * added, each ascending or descending.
 */

import { compareAlbumTracks, compareByTitle, compareStrings } from "./library.ts";

/** What a song list can be sorted by. */
export type SongSortKey = "title" | "artist" | "album" | "added";

/** A song list's sort: what it's sorted by, and which way. */
export interface SongSort {
  readonly key: SongSortKey;
  readonly descending: boolean;
}

/** What `sortSongs` needs to know about a song. */
export interface SortableSong {
  readonly titleSort: string;
  readonly artistSort: string;
  readonly albumSort: string;
  readonly albumId: number;
  readonly discNumber: number | null;
  readonly trackNumber: number | null;
  /** When the file entered the library (epoch ms). */
  readonly addedAt: number;
  readonly path: string;
}

type Compare = (a: SortableSong, b: SortableSong) => number;

/**
 * Keeps an album's tracks together (two albums can share a title) and in disc
 * and track order.
 */
const byAlbumTracks: Compare = (a, b) => a.albumId - b.albumId || compareAlbumTracks(a, b);

const byText =
  (key: (song: SortableSong) => string): Compare =>
  (a, b) =>
    compareStrings(key(a), key(b));

interface Order {
  readonly name: string;
  /** How each direction reads: [ascending, descending]. */
  readonly directions: readonly [string, string];
  /** The part descending reverses. */
  readonly primary: Compare;
  /** What orders songs the primary key can't tell apart; never reversed. */
  readonly ties: Compare;
  /** The sort key the A–Z spine files a song under, when the sort has a spine. */
  readonly spineKey?: (song: SortableSong) => string;
}

const ALPHABETICAL = ["A to Z", "Z to A"] as const;

const ORDERS: Record<SongSortKey, Order> = {
  title: {
    name: "Song name",
    directions: ALPHABETICAL,
    primary: byText((song) => song.titleSort),
    // compareByTitle re-checks the title, which is equal here, then goes by artist.
    ties: compareByTitle,
    spineKey: (song) => song.titleSort,
  },
  artist: {
    name: "Artist",
    directions: ALPHABETICAL,
    primary: byText((song) => song.artistSort),
    ties: (a, b) => compareStrings(a.albumSort, b.albumSort) || byAlbumTracks(a, b),
    spineKey: (song) => song.artistSort,
  },
  album: {
    name: "Album",
    directions: ALPHABETICAL,
    primary: byText((song) => song.albumSort),
    ties: byAlbumTracks,
    spineKey: (song) => song.albumSort,
  },
  added: {
    name: "Date added",
    directions: ["oldest first", "newest first"],
    primary: (a, b) => a.addedAt - b.addedAt,
    ties: compareByTitle,
  },
};

/** Song name A to Z: how song lists are sorted until you choose otherwise. */
export const DEFAULT_SONG_SORT: SongSort = { key: "title", descending: false };

/** Every sort the control offers, in its order: newest first leads for date added. */
export const SONG_SORTS: readonly SongSort[] = [
  { key: "title", descending: false },
  { key: "title", descending: true },
  { key: "artist", descending: false },
  { key: "artist", descending: true },
  { key: "album", descending: false },
  { key: "album", descending: true },
  { key: "added", descending: true },
  { key: "added", descending: false },
];

/** How a sort reads in the control and to screen readers, e.g. "Artist, Z to A". */
export const songSortLabel = (sort: SongSort): string => {
  const order = ORDERS[sort.key];
  return `${order.name}, ${order.directions[sort.descending ? 1 : 0]}`;
};

/**
 * A fresh copy of [songs] in [sort]'s order. Descending reverses the primary
 * key only: ties keep their natural order (an album's tracks still run 1, 2, 3).
 */
export const sortSongs = <S extends SortableSong>(songs: readonly S[], sort: SongSort): S[] => {
  const { primary, ties } = ORDERS[sort.key];
  const direction = sort.descending ? -1 : 1;
  // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh copy; Hermes lacks toSorted
  return [...songs].sort((a, b) => direction * primary(a, b) || ties(a, b));
};

/**
 * The sort key each of [songs] (already in [sort]'s order) is filed under on the
 * A–Z spine, for `alphabetIndex`; undefined when the sort has no spine.
 */
export const songSpineKeys = (
  songs: readonly SortableSong[],
  sort: SongSort,
): readonly string[] | undefined => {
  const { spineKey } = ORDERS[sort.key];
  return spineKey === undefined ? undefined : songs.map(spineKey);
};

/** [sort] as a string to save. */
export const writeSongSort = (sort: SongSort): string =>
  JSON.stringify({ key: sort.key, descending: sort.descending });

/** A sort saved by `writeSongSort`; [fallback] when nothing (readable) was saved. */
export const readSongSort = (
  saved: string | null,
  fallback: SongSort = DEFAULT_SONG_SORT,
): SongSort => {
  if (saved === null) return fallback;
  try {
    const parsed: unknown = JSON.parse(saved);
    if (typeof parsed !== "object" || parsed === null) return fallback;
    const { key, descending } = parsed as Record<string, unknown>;
    const known = SONG_SORTS.find((sort) => sort.key === key && sort.descending === descending);
    return known ?? fallback;
  } catch {
    return fallback;
  }
};
