import type {
  MixedSong,
  SearchGroup,
  SearchKind,
  SearchResults,
  YtSectionNote,
  YtSectionView,
} from "@wave/core";

import type { SongRow } from "@/library/LibraryStore";
import type { NativeYtSong } from "@/native/waveYtMusic";

import type { SearchHit } from "./searchIndex";

/** A song result: the Library's, or one YT Music found that the Library lacks. */
export type ResultSong = MixedSong<NativeYtSong, SongRow>;

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
      readonly songs: readonly ResultSong[];
      /** For songs: YT Music's songs are among the results, so the Library's show as downloaded. */
      readonly downloaded: boolean;
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
    }
  | {
      readonly type: "ytSong";
      readonly key: string;
      readonly song: NativeYtSong;
      /** The song results, which tapping plays from this one ([index]). */
      readonly songs: readonly ResultSong[];
      readonly index: number;
    }
  /** A quiet line in place of results: nothing in the library, YT Music offline… */
  | { readonly type: "note"; readonly key: string; readonly text: string };

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

/** The song results, in the order search ranks them. */
export const songResults = (results: SearchResults<SearchHit>): SongRow[] =>
  songsOf(results.groups.find((group) => group.kind === "song")?.items ?? []);

const NO_YT_SONGS: readonly NativeYtSong[] = [];

/**
 * Lays out results: the top result, then each group (in Core's order) with a
 * preview of its best matches and "Show all". A group the owner expanded, or
 * the only group, shows everything search returned. The songs YT Music found
 * that the Library lacks ([yt], Core's `ytSectionView`) follow the Library's
 * in the Songs group, which they make when the Library has no song matching.
 */
export const resultRows = (
  results: SearchResults<SearchHit>,
  expanded: ReadonlySet<SearchKind>,
  yt: YtSectionView<NativeYtSong> | null = null,
): ResultRow[] => {
  const rows: ResultRow[] = [];
  const ytSongs = yt?.songs ?? NO_YT_SONGS;
  const library = songResults(results);
  const songs: ResultSong[] = [
    ...library.map((track) => ({ source: "library" as const, track })),
    ...ytSongs.map((song) => ({ source: "stream" as const, song })),
  ];
  const downloaded = ytSongs.length > 0;
  const hitRow = (hit: SearchHit, top: boolean): ResultRow => ({
    type: "hit",
    key: `${top ? "top:" : ""}${hitKey(hit)}`,
    hit,
    top,
    songs,
    downloaded,
  });
  if (results.top !== null) {
    rows.push(
      { type: "heading", key: "heading:top", label: "Top result" },
      hitRow(results.top, true),
    );
  }
  const groups: readonly SearchGroup<SearchHit>[] =
    results.groups.some((group) => group.kind === "song") || !downloaded
      ? results.groups
      : [...results.groups, { kind: "song", items: [], total: 0 }];
  for (const group of groups) {
    const extra = group.kind === "song" ? ytSongs : NO_YT_SONGS;
    const total = group.total + extra.length;
    rows.push({
      type: "heading",
      key: `heading:${group.kind}`,
      label: `${LABEL[group.kind]} · ${total.toLocaleString("en")}`,
    });
    const groupRows: ResultRow[] = [
      ...group.items.map((hit) => hitRow(hit, false)),
      ...extra.map((song, index): ResultRow => ({
        type: "ytSong",
        key: `yt:${song.videoId}`,
        song,
        songs,
        index: library.length + index,
      })),
    ];
    const open = expanded.has(group.kind) || groups.length === 1;
    const shown = open ? groupRows : groupRows.slice(0, PREVIEW[group.kind]);
    rows.push(...shown);
    if (shown.length < total && !open)
      rows.push({ type: "more", key: `more:${group.kind}`, kind: group.kind, total });
    else if (shown.length < total)
      rows.push({ type: "capped", key: `capped:${group.kind}`, shown: shown.length, total });
  }
  return rows;
};

/** The line standing in for the library's results when nothing in it matches. */
export const noLibraryResultsRow = (query: string): ResultRow => ({
  type: "note",
  key: "note:library",
  text: `Nothing in your library matches “${query.trim()}”.`,
});

/** YT Music's quiet lines; with its songs among the Library's, "nothing new" needs no line. */
const YT_NOTE: Readonly<Record<YtSectionNote, string | null>> = {
  searching: "Searching YT Music…",
  noMatches: null,
  allInLibrary: null,
  offline: "You're offline. Songs from YT Music show here when you're back online.",
  failed: "YT Music didn't answer. Try again in a moment.",
};

/** YT Music's quiet line under the results, if it has one. */
export const ytNoteRows = (view: YtSectionView<NativeYtSong> | null): ResultRow[] => {
  const note = view?.note ?? null;
  const text = note === null ? null : YT_NOTE[note];
  return text === null ? [] : [{ type: "note", key: "note:yt", text }];
};
