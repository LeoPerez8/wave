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
  /** A lyric phrase (Core's `isLyricPhraseQuery`) puts Lyrics before everything else. */
  readonly lyricsFirst: boolean;
  /**
   * The query names the top result's song by its title and artist (Core's `queryNamesSong`):
   * it isn't a lyric phrase, and Genius isn't asked (#1470).
   */
  readonly namesSong: boolean;
}

/** What a section shows: some of its matches, and whether "Show all" or the cap note follows. */
interface Shown {
  /** How many it shows. */
  readonly shown: number;
  /** How many match. */
  readonly total: number;
  /** "Show all" follows: the section shows a preview. */
  readonly more: boolean;
  /** The section is open but lists only the best `shown` of `total`. */
  readonly capped: boolean;
}

export type SearchSection =
  | { readonly type: "top"; readonly result: SearchResult }
  | (Shown & {
      readonly type: "songs" | "shelf";
      readonly kind: SearchKind;
      readonly rows: readonly BrowseRow[];
    })
  | (Shown & {
      readonly type: "lyrics";
      readonly hits: readonly LyricsHitView[];
      /** The first hit's place among the songs a search plays (after its Songs group). */
      readonly firstIndex: number;
    });

/** A section [expanded] holds shows every match it has. */
export type SearchExpansion = ReadonlySet<SearchKind | "lyrics">;

/**
 * The desktop's Search page: the top result, the Songs table, then the other groups as shelves
 * in Albums, Artists, Playlists, Genres order. A group shows a preview with "Show all",
 * unless it's opened or the only one. Lyrics follow Songs, follow the top result when no song
 * matches, and lead when the query is a lyric phrase (three or more words that don't name the
 * top song by its title and artist).
 */
export const searchSections = (
  view: LibrarySearchView,
  expanded: SearchExpansion,
): SearchSection[] => {
  const sections: SearchSection[] = [];
  if (view.top !== null) sections.push({ type: "top", result: view.top });
  const afterTop = sections.length;
  const songs = view.groups.find((group) => group.kind === "song");
  const lyrics = (): SearchSection[] => {
    const total = view.lyrics.length;
    if (total === 0) return [];
    const hits = expanded.has("lyrics") ? view.lyrics : view.lyrics.slice(0, LYRICS_PREVIEW);
    return [
      {
        type: "lyrics",
        hits,
        shown: hits.length,
        total,
        more: hits.length < total,
        capped: false,
        firstIndex: songs?.items.length ?? 0,
      },
    ];
  };
  const groups = (["song", "album", "artist", "playlist", "genre"] as const).flatMap((kind) =>
    view.groups.filter((group) => group.kind === kind),
  );
  for (const group of groups) {
    const open = expanded.has(group.kind) || view.groups.length === 1;
    const rows = open ? group.items : group.items.slice(0, SEARCH_PREVIEW[group.kind]);
    sections.push({
      type: group.kind === "song" ? "songs" : "shelf",
      kind: group.kind,
      rows,
      shown: rows.length,
      total: group.total,
      more: !open && rows.length < group.total,
      capped: open && rows.length < group.total,
    });
    if (group.kind === "song" && !view.lyricsFirst) sections.push(...lyrics());
  }
  if (view.lyricsFirst) sections.unshift(...lyrics());
  else if (songs === undefined) sections.splice(afterTop, 0, ...lyrics());
  return sections;
};
