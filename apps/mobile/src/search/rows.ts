import { formatNumber, type AppLanguage } from "@wave/core";
import type {
  DiscoverSong,
  MixedSong,
  SearchGroup,
  SearchKind,
  SearchResults,
  SongsInPlace,
  YtArtistAlbum,
  YtArtistCandidate,
  YtSearchTop,
  YtSectionNote,
  YtSectionView,
} from "@wave/core";

import type { SongRow } from "@/library/LibraryStore";
import type { NativeYtSong } from "@/native/waveYtMusic";

import { songHit, type SearchHit } from "./searchIndex";
import type { TopArtistSongs } from "./topArtistSongs";

/** A song result: the Library's, or one YT Music found that the Library lacks. */
export type ResultSong = MixedSong<NativeYtSong, SongRow>;

/**
 * A song YT Music found, in its place among them (Core's `songsInPlace`):
 * streamed, or the Library's file once its download finished.
 */
type PlacedYtSong = DiscoverSong<NativeYtSong, SongRow>;

/** YT Music's songs in their places, and the row each plays from (Core's `songsInPlace`). */
export type PlacedYtSongs = Pick<SongsInPlace<NativeYtSong, SongRow, number>, "songs" | "rowOf">;

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
      /**
       * For the top-hit Library artist with Online: their song count with the
       * online songs the Library lacks (`useTopArtistSongs`); null: the Library's.
       */
      readonly artistSongs: number | null;
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
      readonly top: boolean;
    }
  /** An artist YT Music found that the Library lacks: opens their YouTube Music artist page. */
  | {
      readonly type: "ytArtist";
      readonly key: string;
      readonly artist: YtArtistCandidate;
      readonly top: boolean;
    }
  /** An album YT Music found that the Library lacks: opens its YT Music album page. */
  | {
      readonly type: "ytAlbum";
      readonly key: string;
      readonly album: YtArtistAlbum;
      readonly top: boolean;
    }
  /** A quiet line in place of results: nothing in the library, YT Music offline… */
  | { readonly type: "note"; readonly key: string; readonly text: string }
  /** Skeleton rows where online results will go, while they load. */
  | { readonly type: "skeleton"; readonly key: string };

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

const NO_YT_ARTISTS: readonly YtArtistCandidate[] = [];
const NO_YT_ALBUMS: readonly YtArtistAlbum[] = [];

/** The kinds YT Music adds to, in the order their groups are added when the Library has none. */
const YT_KINDS: readonly SearchKind[] = ["artist", "album", "song"];

const ytArtistRow = (artist: YtArtistCandidate, top: boolean): ResultRow => ({
  type: "ytArtist",
  key: `${top ? "top:" : ""}yt-artist:${artist.browseId}`,
  artist,
  top,
});
const streamed = (song: NativeYtSong): PlacedYtSong => ({ source: "stream", song });

const ytAlbumRow = (album: YtArtistAlbum, top: boolean): ResultRow => ({
  type: "ytAlbum",
  key: `${top ? "top:" : ""}yt-album:${album.browseId}`,
  album,
  top,
});

/**
 * Lays out results: the top result, then each group (in Core's order) with a
 * preview of its best matches and "Show all". A group the owner expanded, or
 * the only group, shows everything search returned. The songs, artists and
 * albums YT Music found that the Library lacks ([yt], Core's `ytSectionView`)
 * follow the Library's in the Songs, Artists and Albums groups, making the
 * group when the Library has nothing of its kind; groups count them too. The
 * top result is the Library's best match, else YT Music's best. [placed] are
 * YT Music's songs kept in place for the visit: one whose download finished
 * shows as the Library's song in its row (and [results] leave it out), and
 * one shown as an earlier row's Library file plays from that row.
 * [topArtist] is the top-hit Library artist's merged song count, for their rows.
 */
export const resultRows = (
  results: SearchResults<SearchHit>,
  expanded: ReadonlySet<SearchKind>,
  yt: YtSectionView<NativeYtSong> | null,
  { songs: placed, rowOf }: PlacedYtSongs,
  topArtist: TopArtistSongs | null = null,
  language: AppLanguage = "en",
): ResultRow[] => {
  const rows: ResultRow[] = [];
  const ytArtists = yt?.artists ?? NO_YT_ARTISTS;
  const ytAlbums = yt?.albums ?? NO_YT_ALBUMS;
  const library = songResults(results);
  const songs: ResultSong[] = [
    ...library.map((track) => ({ source: "library" as const, track })),
    ...placed,
  ];
  const ytSongRow = (song: NativeYtSong, index: number, top: boolean): ResultRow => ({
    type: "ytSong",
    key: `${top ? "top:" : ""}yt:${song.videoId}`,
    song,
    songs,
    index: library.length + index,
    top,
  });
  const hitRow = (hit: SearchHit, top: boolean): ResultRow => ({
    type: "hit",
    key: `${top ? "top:" : ""}${hitKey(hit)}`,
    hit,
    top,
    songs,
    artistSongs:
      hit.kind === "artist" && topArtist?.artistId === hit.artist.id ? topArtist.songs : null,
  });
  const placedRow = (row: PlacedYtSong, index: number, top: boolean): ResultRow =>
    row.source === "library" ? hitRow(songHit(row.track), top) : ytSongRow(row.song, index, top);
  const ytTopRow = (top: YtSearchTop<NativeYtSong>): ResultRow => {
    switch (top.kind) {
      case "artist":
        return ytArtistRow(top.artist, true);
      case "album":
        return ytAlbumRow(top.album, true);
      case "song": {
        const index = rowOf.get(top.song.videoId) ?? -1;
        const row = placed[index];
        if (row !== undefined) return placedRow(row, index, true);
        // YT Music's best is one of the songs shown, so it has a row; if not, it plays alone.
        const song = top.song;
        return {
          type: "ytSong",
          key: `top:yt:${song.videoId}`,
          song,
          songs: [streamed(song)],
          index: 0,
          top: true,
        };
      }
    }
  };
  const ytRows = (kind: SearchKind): ResultRow[] => {
    switch (kind) {
      case "artist":
        return ytArtists.map((artist) => ytArtistRow(artist, false));
      case "album":
        return ytAlbums.map((album) => ytAlbumRow(album, false));
      case "song":
        return placed.map((row, index) => placedRow(row, index, false));
      default:
        return [];
    }
  };
  const ytTop = yt?.top ?? null;
  if (results.top !== null) {
    rows.push(
      { type: "heading", key: "heading:top", label: "Top result" },
      hitRow(results.top, true),
    );
  } else if (ytTop !== null) {
    rows.push({ type: "heading", key: "heading:top", label: "Top result" }, ytTopRow(ytTop));
  }
  const groups: SearchGroup<SearchHit>[] = [...results.groups];
  for (const kind of YT_KINDS)
    if (ytRows(kind).length > 0 && !groups.some((group) => group.kind === kind))
      groups.push({ kind, items: [], total: 0 });
  for (const group of groups) {
    const extra = ytRows(group.kind);
    const total = group.total + extra.length;
    rows.push({
      type: "heading",
      key: `heading:${group.kind}`,
      label: `${LABEL[group.kind]} · ${formatNumber(language, total)}`,
    });
    const groupRows: ResultRow[] = [...group.items.map((hit) => hitRow(hit, false)), ...extra];
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

/** Online's quiet lines. */
const YT_NOTE: Readonly<Record<YtSectionNote, string>> = {
  noMatches: "Nothing online matches.",
  allInLibrary: "Everything found online is already in your library.",
  offline: "You're offline. Tap Online to try again when you're back online.",
  failed: "Couldn't search online. Tap Online to try again.",
};

/**
 * What follows the Library's results for Online: skeleton rows while the
 * query loads (where its results will go), else its quiet line, if any.
 */
export const ytFooterRows = (view: YtSectionView<NativeYtSong> | null): ResultRow[] => {
  if (view === null) return [];
  if (view.loading) return [{ type: "skeleton", key: "skeleton:yt" }];
  return view.note === null ? [] : [{ type: "note", key: "note:yt", text: YT_NOTE[view.note] }];
};
