import type { SearchKind, SearchResults } from "@wave/core";

import type { SongRow } from "@/library/LibraryStore";

import type { SearchHit } from "./searchIndex";

/** One row of the results list: a section head, a result, or a group's "Show all". */
export type ResultRow =
  | { readonly type: "heading"; readonly key: string; readonly label: string }
  | {
      readonly type: "hit";
      readonly key: string;
      readonly hit: SearchHit;
      /** The top result says what type it is. */
      readonly top: boolean;
      /** For songs: the song results, which tapping plays from this one. */
      readonly songs: readonly SongRow[];
    }
  | {
      readonly type: "more";
      readonly key: string;
      readonly kind: SearchKind;
      readonly total: number;
    }
  | {
      readonly type: "capped";
      readonly key: string;
      readonly shown: number;
      readonly total: number;
    };

/** The most results of one type the search returns (and a song tap queues). */
export const RESULT_LIMIT = 200;

/** Rows a group shows before "Show all". */
const PREVIEW: Readonly<Record<SearchKind, number>> = {
  artist: 4,
  album: 4,
  song: 8,
  playlist: 4,
  genre: 4,
};

const LABEL: Readonly<Record<SearchKind, string>> = {
  artist: "Artists",
  album: "Albums",
  song: "Songs",
  playlist: "Playlists",
  genre: "Genres",
};

const hitId = (hit: SearchHit): number => {
  switch (hit.kind) {
    case "artist":
      return hit.artist.id;
    case "album":
      return hit.album.id;
    case "song":
      return hit.song.id;
    case "playlist":
      return hit.playlist.id;
    case "genre":
      return hit.genre.id;
  }
};

const hitKey = (hit: SearchHit): string => `${hit.kind}:${hitId(hit)}`;

const songsOf = (hits: readonly SearchHit[]): SongRow[] =>
  hits.flatMap((hit) => (hit.kind === "song" ? [hit.song] : []));

/**
 * Lays out results: the top result, then each group (in Core's order) with a
 * preview of its best matches and "Show all". A group the owner expanded, or
 * the only group, shows everything search returned.
 */
export const resultRows = (
  results: SearchResults<SearchHit>,
  expanded: ReadonlySet<SearchKind>,
): ResultRow[] => {
  const rows: ResultRow[] = [];
  const songs = songsOf(results.groups.find((group) => group.kind === "song")?.items ?? []);
  if (results.top !== null) {
    rows.push(
      { type: "heading", key: "heading:top", label: "Top result" },
      { type: "hit", key: `top:${hitKey(results.top)}`, hit: results.top, top: true, songs },
    );
  }
  for (const group of results.groups) {
    rows.push({
      type: "heading",
      key: `heading:${group.kind}`,
      label: `${LABEL[group.kind]} · ${group.total.toLocaleString("en")}`,
    });
    const open = expanded.has(group.kind) || results.groups.length === 1;
    const shown = open ? group.items : group.items.slice(0, PREVIEW[group.kind]);
    for (const hit of shown) rows.push({ type: "hit", key: hitKey(hit), hit, top: false, songs });
    if (shown.length < group.total && !open)
      rows.push({ type: "more", key: `more:${group.kind}`, kind: group.kind, total: group.total });
    else if (shown.length < group.total)
      rows.push({
        type: "capped",
        key: `capped:${group.kind}`,
        shown: shown.length,
        total: group.total,
      });
  }
  return rows;
};
