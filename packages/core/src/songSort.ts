/**
 * The orders a song list can be sorted in (Library › Songs, an artist's,
 * genre's or folder's songs, Favorites): by song name, artist, album or date
 * added, each ascending or descending, plus a list's own order where it has one
 * (a folder's file names, when Favorites were starred).
 */

import { readStoredRecord } from "./storedJson.ts";
import { compareFileNames } from "./browse.ts";
import { compareAlbumTracks, compareByTitle, compareStrings } from "./library.ts";

/** What a song list can be sorted by. */
export type SongSortKey = "title" | "artist" | "album" | "added" | "file" | "starred";

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
  /** When the song was starred (epoch ms); only Favorites sort by it. */
  readonly starredAt?: number | undefined;
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

const fileName = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

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
  file: {
    name: "File name",
    directions: ALPHABETICAL,
    primary: (a, b) => compareFileNames(fileName(a.path), fileName(b.path)),
    ties: (a, b) => compareStrings(a.path, b.path),
  },
  starred: {
    name: "Date starred",
    directions: ["oldest first", "newest first"],
    primary: (a, b) => (a.starredAt ?? 0) - (b.starredAt ?? 0),
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

/**
 * The kinds of song list with a sort control. Every list of a kind shares one
 * sort: sorting one artist's songs by album sorts every artist's.
 */
export type SongListKind = "songs" | "artist" | "genre" | "folder" | "favorites";

/** Whether two sorts are the same: one key, one direction. */
export const sameSongSort = (a: SongSort, b: SongSort): boolean =>
  a.key === b.key && a.descending === b.descending;

/** A list's own order, offered first (and its default) where it isn't song name A to Z. */
const OWN_ORDER: Partial<Record<SongListKind, readonly [SongSort, SongSort]>> = {
  // The file-manager order a folder has always had.
  folder: [
    { key: "file", descending: false },
    { key: "file", descending: true },
  ],
  // Most recently starred first, as Favorites has always been.
  favorites: [
    { key: "starred", descending: true },
    { key: "starred", descending: false },
  ],
};

/** The sorts a [kind] list offers, in the control's order: its own order leads. */
export const songSortsFor = (kind: SongListKind): readonly SongSort[] => {
  const own = OWN_ORDER[kind];
  return own === undefined ? SONG_SORTS : [...own, ...SONG_SORTS];
};

/** How a [kind] list is sorted until you choose otherwise: the order it always had. */
export const defaultSongSort = (kind: SongListKind): SongSort =>
  OWN_ORDER[kind]?.[0] ?? DEFAULT_SONG_SORT;

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

/**
 * A [kind] list's sort saved by `writeSongSort`; the kind's default when nothing
 * (readable, and on offer for the kind) was saved.
 */
export const readSongSort = (saved: string | null, kind: SongListKind = "songs"): SongSort => {
  const { key, descending } = readStoredRecord(saved);
  return (
    songSortsFor(kind).find((sort) => sort.key === key && sort.descending === descending) ??
    defaultSongSort(kind)
  );
};
