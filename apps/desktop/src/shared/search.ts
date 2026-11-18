/** Search over the Library, as Core ranks it on the phone. */
import type { SearchKind } from "@wave/core";
import type { BrowseRow } from "./browse.ts";

export type { SearchKind };

/** The most results of one type a search returns, as on the phone. */
export const SEARCH_RESULT_LIMIT = 200;

/** Rows a group shows before "Show all", as on the phone. */
export const SEARCH_PREVIEW: Readonly<Record<SearchKind, number>> = {
  artist: 4,
  album: 4,
  song: 8,
  playlist: 4,
  genre: 4,
};

/** Lyrics hits shown before "Show all". */
export const LYRICS_PREVIEW = 5;

export interface SearchResult {
  readonly kind: SearchKind;
  readonly row: BrowseRow;
}

export interface SearchGroupView {
  readonly kind: SearchKind;
  /** Best match first, at most `SEARCH_RESULT_LIMIT`. */
  readonly items: readonly BrowseRow[];
  /** How many of this type match. */
  readonly total: number;
}

/** A Library song whose lyrics hold the query's words, with the line they're in. */
export interface LyricsHitView {
  readonly row: BrowseRow;
  readonly line: string;
  /** UTF-16 ranges of `line` to highlight. */
  readonly ranges: readonly { readonly start: number; readonly end: number }[];
}

export interface LibrarySearchView {
  readonly query: string;
  /** The best match of any type; it stays in its group too. */
  readonly top: SearchResult | null;
  /** One group per type with matches, ordered by their best match (Core's order). */
  readonly groups: readonly SearchGroupView[];
  /** Songs found by their lyrics that the Songs group doesn't already show. */
  readonly lyrics: readonly LyricsHitView[];
  /** Three or more words put Lyrics before everything else. */
  readonly lyricsFirst: boolean;
}
