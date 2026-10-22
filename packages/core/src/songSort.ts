/**
 * The orders a song list can be sorted in (Library › Songs, an artist's or
 * genre's songs, Favorites): by song name, artist, album or date added, each
 * ascending or descending, plus a list's own order where it has one (Favorites'
 * date starred, an artist's Popular: YouTube Music's order of their songs).
 */

import { readStoredRecord } from "./storedJson.ts";
import { compareAlbumTracks, compareByTitle, compareStrings } from "./library.ts";

/** What a song list can be sorted by. */
export type SongSortKey = "title" | "artist" | "album" | "added" | "starred" | "popular";

/** A song list's sort: what it's sorted by, and which way. */
export interface SongSort {
  readonly key: SongSortKey;
  readonly descending: boolean;
}

/**
 * A sort the Library's own tables can order by: every one but the two that need
 * what the Library's tables don't hold (date starred, Popular).
 */
export type LibrarySongSort = SongSort & {
  readonly key: Exclude<SongSortKey, "starred" | "popular">;
};

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
  /** The file; null for a missing song. */
  readonly path: string | null;
  /** When the song was starred (epoch ms); only Favorites sort by it. */
  readonly starredAt?: number | undefined;
  /**
   * The song's place in its artist's YouTube Music list (1 is the most
   * popular), or undefined when the list doesn't hold it; only Popular sorts by
   * it (`rankPopular` gives it).
   */
  readonly popularRank?: number | undefined;
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

/** Where an unranked song sorts under Popular: after every ranked one. */
const UNRANKED = Number.MAX_SAFE_INTEGER;

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
  starred: {
    name: "Date starred",
    directions: ["oldest first", "newest first"],
    primary: (a, b) => (a.starredAt ?? 0) - (b.starredAt ?? 0),
    ties: compareByTitle,
  },
  popular: {
    name: "Popular",
    // Offered one way only: its label reads the name alone (`songSortLabel`).
    directions: ["most popular first", "most popular first"],
    primary: (a, b) => (a.popularRank ?? UNRANKED) - (b.popularRank ?? UNRANKED),
    // Songs the list doesn't hold come after the ranked ones, in song name order.
    ties: compareByTitle,
  },
};

/** Song name A to Z: how song lists are sorted until you choose otherwise. */
export const DEFAULT_SONG_SORT: SongSort = { key: "title", descending: false };

/** Every sort the control offers, in its order: newest first leads for date added. */
export const SONG_SORTS: readonly LibrarySongSort[] = [
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
export type SongListKind = "songs" | "artist" | "genre" | "favorites";

/** Whether two sorts are the same: one key, one direction. */
export const sameSongSort = (a: SongSort, b: SongSort): boolean =>
  a.key === b.key && a.descending === b.descending;

/** A list's own orders, offered first (the first is its default) where it isn't song name A to Z. */
const OWN_ORDER: Partial<Record<SongListKind, readonly SongSort[]>> = {
  // Most recently starred first, as Favorites has always been.
  favorites: [
    { key: "starred", descending: true },
    { key: "starred", descending: false },
  ],
  // An artist's songs in YouTube Music's order, unless the owner chose another sort.
  artist: [{ key: "popular", descending: false }],
};

/** The sorts a [kind] list offers, in the control's order: its own orders lead. */
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
  return sort.key === "popular"
    ? order.name
    : `${order.name}, ${order.directions[sort.descending ? 1 : 0]}`;
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

/** A song field a list's order compares, as the Library's tables hold it (`id` is the Track's). */
export type SongOrderField =
  | "titleSort"
  | "artistSort"
  | "albumSort"
  | "albumId"
  | "discNumber"
  | "trackNumber"
  | "addedAt"
  | "path"
  | "id";

/** One step of an order the database runs (an `ORDER BY` term). */
export interface SongOrderTerm {
  readonly field: SongOrderField;
  readonly descending: boolean;
  /** What a null compares as (a missing disc is disc 1); absent where the field is never null. */
  readonly nullAs?: number | string;
}

/**
 * [sort], or song name A to Z for date starred and Popular, which the Library's
 * tables can't order by.
 */
export const librarySongSort = (sort: SongSort): LibrarySongSort =>
  sort.key === "starred" || sort.key === "popular"
    ? (DEFAULT_SONG_SORT as LibrarySongSort)
    : (sort as LibrarySongSort);

const ascending = (field: SongOrderField, nullAs?: number | string): SongOrderTerm =>
  nullAs === undefined ? { field, descending: false } : { field, descending: false, nullAs };

/** compareFiles, then the id: songs alike in everything else keep one order. */
const BY_FILE: readonly SongOrderTerm[] = [ascending("path", ""), ascending("id")];

/** compareByTitle. */
const BY_TITLE: readonly SongOrderTerm[] = [
  ascending("titleSort"),
  ascending("artistSort"),
  ...BY_FILE,
];

/** byAlbumTracks: the album, then compareAlbumTracks. */
const BY_ALBUM_TRACKS: readonly SongOrderTerm[] = [
  ascending("albumId"),
  ascending("discNumber", 1),
  ascending("trackNumber", Number.MAX_SAFE_INTEGER),
  ascending("titleSort"),
  ...BY_FILE,
];

/** Each sort's primary field and its ties, as `ORDERS` compares them. */
const ORDER_TERMS: Record<
  LibrarySongSort["key"],
  readonly [SongOrderField, readonly SongOrderTerm[]]
> = {
  title: ["titleSort", BY_TITLE],
  artist: ["artistSort", [ascending("albumSort"), ...BY_ALBUM_TRACKS]],
  album: ["albumSort", BY_ALBUM_TRACKS],
  added: ["addedAt", BY_TITLE],
};

/**
 * [sort] as the database runs it: the order `sortSongs` gives, as `ORDER BY`
 * terms, ending on the Track id so the order is total (pages of it never
 * overlap or skip). Strings compare as SQLite's BINARY collation does, by code
 * point; `sortSongs` compares UTF-16 units, which differ only between
 * characters past U+FFFF and those from U+E000 to U+FFFF.
 */
export const songOrderTerms = (sort: LibrarySongSort): readonly SongOrderTerm[] => {
  const [primary, ties] = ORDER_TERMS[sort.key];
  return [{ field: primary, descending: sort.descending }, ...ties];
};

/** The field [sort] files a song under on the A–Z spine (`songSpineKeys`); none for the date sorts. */
export const songSpineField = (sort: LibrarySongSort): SongOrderField | undefined =>
  ORDERS[sort.key].spineKey === undefined ? undefined : ORDER_TERMS[sort.key][0];

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
