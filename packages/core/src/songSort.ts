/**
 * The orders a song list can be sorted in (Library › Songs, an artist's or
 * genre's songs, Favorites): by song name, artist, album or date added, each
 * ascending or descending, plus a list's own order where it has one (Favorites'
 * date starred, an artist's Popular: YouTube Music's order of their songs).
 */

import { catalogueOf, type AppLanguage } from "./localisation.ts";
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

type Direction = "aToZ" | "zToA" | "oldestFirst" | "newestFirst";

interface Order {
  /** How each direction reads: [ascending, descending]; none for a sort offered one way. */
  readonly directions: readonly [Direction, Direction] | null;
  /** The part descending reverses. */
  readonly primary: Compare;
  /** What orders songs the primary key can't tell apart; never reversed. */
  readonly ties: Compare;
  /** The sort key the A–Z spine files a song under, when the sort has a spine. */
  readonly spineKey?: (song: SortableSong) => string;
}

const ALPHABETICAL = ["aToZ", "zToA"] as const;

/** Where an unranked song sorts under Popular: after every ranked one. */
const UNRANKED = Number.MAX_SAFE_INTEGER;

const ORDERS: Record<SongSortKey, Order> = {
  title: {
    directions: ALPHABETICAL,
    primary: byText((song) => song.titleSort),
    // compareByTitle re-checks the title, which is equal here, then goes by artist.
    ties: compareByTitle,
    spineKey: (song) => song.titleSort,
  },
  artist: {
    directions: ALPHABETICAL,
    primary: byText((song) => song.artistSort),
    ties: (a, b) => compareStrings(a.albumSort, b.albumSort) || byAlbumTracks(a, b),
    spineKey: (song) => song.artistSort,
  },
  album: {
    directions: ALPHABETICAL,
    primary: byText((song) => song.albumSort),
    ties: byAlbumTracks,
    spineKey: (song) => song.albumSort,
  },
  added: {
    directions: ["oldestFirst", "newestFirst"],
    primary: (a, b) => a.addedAt - b.addedAt,
    ties: compareByTitle,
  },
  starred: {
    directions: ["oldestFirst", "newestFirst"],
    primary: (a, b) => (a.starredAt ?? 0) - (b.starredAt ?? 0),
    ties: compareByTitle,
  },
  popular: {
    // Offered one way only: its label reads the name alone (`songSortLabel`).
    directions: null,
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

/** How a sort reads in [language]'s control and to screen readers, e.g. "Artist, Z to A". */
export const songSortLabelFor =
  (language: AppLanguage) =>
  (sort: SongSort): string => {
    const text = catalogueOf(language).library;
    const { directions } = ORDERS[sort.key];
    const name = text.songSorts[sort.key];
    return directions === null
      ? name
      : text.sortLabel(name, text.sortDirections[directions[sort.descending ? 1 : 0]]);
  };

/** How a sort reads in English. */
export const songSortLabel = songSortLabelFor("en");

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

/** Whether the list is filed under names for letter jumps. */
export const songSortHasSpine = (sort: SongSort): boolean =>
  ORDERS[sort.key].spineKey !== undefined;

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
export interface SongOrderTerm<Field extends string = SongOrderField> {
  readonly field: Field;
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
  // not UI text: a column name
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

/** The browse query has the date starred in Favorites and uses song name order until Popular is ranked. */
export const songBrowseOrderTerms = (
  sort: SongSort,
): readonly SongOrderTerm<SongOrderField | "starredAt">[] => {
  const seen = new Set<SongOrderField>();
  const terms = songOrderTerms(librarySongSort(sort)).filter(
    ({ field }) => !seen.has(field) && seen.add(field),
  );
  return sort.key === "starred"
    ? [{ field: "starredAt", descending: sort.descending }, ...terms]
    : terms;
};

/** The field [sort] files a song under on the A–Z spine (`songSpineKeys`), when it has one. */
export const songSpineField = (sort: SongSort): SongOrderField | undefined =>
  songSortHasSpine(sort) ? ORDER_TERMS[librarySongSort(sort).key][0] : undefined;

/** [sort] as a string to save. */
export const writeSongSort = (sort: SongSort): string =>
  JSON.stringify({ key: sort.key, descending: sort.descending });

/**
 * A [kind] list's sort saved by `writeSongSort`; the kind's default when nothing
 * (readable, and on offer for the kind) was saved.
 */
export const readSongSort = (saved: string | null, kind: SongListKind = "songs"): SongSort =>
  readLibraryTableSort(songSortsFor(kind), saved) ?? defaultSongSort(kind);

const NAME_SORTS = SONG_SORTS.filter(({ key }) => key === "title");

/**
 * The desktop tables with sortable headers that share one sort per kind: the top-level Library
 * lists, and an artist's and a genre's songs. A playlist keeps its own (`PLAYLIST_SONG_SORTS`).
 */
export const libraryTableSortsFor = (kind: string): readonly SongSort[] => {
  switch (kind) {
    case "songs":
    case "favorites":
    case "artist":
    case "genre":
      return songSortsFor(kind);
    case "albums":
    case "artists":
    case "genres":
      return NAME_SORTS;
    default:
      return [];
  }
};

/** Read a table's saved choice, or its default when the choice is missing or no longer offered. */
export const readLibraryTableSort = (choices: readonly SongSort[], saved: string | null) => {
  const { key, descending } = readStoredRecord(saved);
  return choices.find((sort) => sort.key === key && sort.descending === descending) ?? choices[0];
};

/** A new header starts in its first offered direction. The current one reverses when possible. */
export const nextHeaderSort = <S extends { readonly key: string; readonly descending: boolean }>(
  choices: readonly S[],
  current: S,
  key: string,
): S | undefined =>
  choices.find(
    (sort) =>
      sort.key === key && !(sort.key === current.key && sort.descending === current.descending),
  );
