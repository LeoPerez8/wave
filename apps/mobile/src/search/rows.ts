import {
  catalogueOf,
  formatNumber,
  GENIUS_LYRICS_SEARCH_PREVIEW,
  joinArtists,
  normalizeSearchText,
  uniqueGeniusLyricsHits,
  type AppLanguage,
} from "@wave/core";
import type {
  DiscoverSong,
  MixedSong,
  SearchGroup,
  SearchKind,
  SearchResults,
  SongsInPlace,
  GeniusLyricsHit,
  YtArtistAlbum,
  YtArtistCandidate,
  YtSearchTop,
  YtSectionNote,
  YtSectionView,
} from "@wave/core";

import type { SongRow } from "@/library/LibraryStore";
import type { NativeYtSong } from "@/native/waveYtMusic";

import type { SearchHit } from "./searchIndex";
import type { LocalLyricsHit } from "./lyricsSearch";
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
  | { readonly type: "lyric"; readonly key: string; readonly hit: LocalLyricsHit }
  | { readonly type: "geniusLyric"; readonly key: string; readonly hit: GeniusLyricsHit }
  | {
      readonly type: "geniusState";
      readonly key: string;
      readonly status: "signedOut" | "offline" | "failed";
    }
  | { readonly type: "moreLyrics"; readonly key: string; readonly total: number }
  | {
      readonly type: "hit";
      readonly key: string;
      readonly hit: SearchHit;
      /** The top result says what type it is. */
      readonly top: boolean;
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

/** The most results of one type the search returns. */
export const RESULT_LIMIT = 200;

/** Rows a group shows before "Show all". */
const PREVIEW: Readonly<Record<SearchKind, number>> = {
  artist: 4,
  album: 4,
  song: 8,
  playlist: 4,
  genre: 4,
};
const LYRIC_PREVIEW = 5;

const lyricRows = (
  hits: readonly LocalLyricsHit[],
  geniusHits: readonly GeniusLyricsHit[],
  expanded: boolean,
  language: AppLanguage,
  onlineStatus: "signedOut" | "offline" | "failed" | null,
): ResultRow[] => {
  if (hits.length === 0 && geniusHits.length === 0 && onlineStatus === null) return [];
  const shown = expanded ? hits : hits.slice(0, LYRIC_PREVIEW);
  const shownGenius = expanded ? geniusHits : geniusHits.slice(0, GENIUS_LYRICS_SEARCH_PREVIEW);
  const total = hits.length + geniusHits.length;
  return [
    {
      type: "heading",
      key: "heading:lyrics",
      label: `${catalogueOf(language).playbackText.lyricsSearchSection} · ${formatNumber(language, total)}`,
    },
    ...shown.map((hit) => ({
      type: "lyric" as const,
      key: hit.source === "library" ? `lyrics:${hit.song.id}` : `lyrics:yt:${hit.song.videoId}`,
      hit,
    })),
    ...shownGenius.map((hit) => ({
      type: "geniusLyric" as const,
      key: `genius-lyrics:${hit.id}`,
      hit,
    })),
    ...(onlineStatus === null
      ? []
      : [
          {
            type: "geniusState" as const,
            key: `genius-state:${onlineStatus}`,
            status: onlineStatus,
          },
        ]),
    ...(shown.length < hits.length || shownGenius.length < geniusHits.length
      ? [{ type: "moreLyrics" as const, key: "more:lyrics", total }]
      : []),
  ];
};

const labels = (language: AppLanguage): Readonly<Record<SearchKind, string>> => ({
  artist: catalogueOf(language).playbackText.artists,
  album: catalogueOf(language).playbackText.albums,
  song: catalogueOf(language).playbackText.songs,
  playlist: catalogueOf(language).playbackText.playlists,
  genre: catalogueOf(language).playbackText.genres,
});

const songHit = (song: SongRow): SearchHit => ({
  kind: "song",
  name: song.title,
  also: [song.artist, song.album],
  song,
});

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
  lyrics: readonly LocalLyricsHit[] = [],
  lyricsExpanded = false,
  query = "",
  geniusLyrics: readonly GeniusLyricsHit[] = [],
  onlineStatus: "signedOut" | "offline" | "failed" | null = null,
): ResultRow[] => {
  const rows: ResultRow[] = [];
  // The Library songs Songs shows, which Lyrics leaves out.
  const shownLibrary = [
    ...results.groups.flatMap((group) =>
      group.kind === "song"
        ? group.items.flatMap((hit) => (hit.kind === "song" ? [hit.song] : []))
        : [],
    ),
    ...placed.flatMap((row) => (row.source === "library" ? [row.track] : [])),
    ...(results.top?.kind === "song" ? [results.top.song] : []),
  ];
  const songIds = new Set(shownLibrary.map((song) => song.id));
  const streamedVideoIds = new Set(
    placed.flatMap((row) => (row.source === "stream" ? [row.song.videoId] : [])),
  );
  const visibleLyrics = lyrics.filter((hit) =>
    hit.source === "library" ? !songIds.has(hit.song.id) : !streamedVideoIds.has(hit.song.videoId),
  );
  // Genius's hits leave out the songs a Lyrics row shows. A song in Songs keeps its hit: a
  // phrase query finds its song in Lyrics, so the original isn't left to its covers (#1115).
  const lyricSongs = visibleLyrics.map((hit) =>
    hit.source === "library"
      ? {
          title: hit.song.title,
          artist: hit.song.artist,
          album: hit.song.album,
          durationMs: hit.song.durationMs,
        }
      : {
          title: hit.song.title,
          artist: joinArtists(hit.song.artists),
          album: hit.song.album,
          durationMs: hit.song.durationMs ?? 0,
        },
  );
  const visibleGenius = uniqueGeniusLyricsHits(geniusLyrics, lyricSongs);
  const wordCount = normalizeSearchText(query).split(" ").filter(Boolean).length;
  const lyricsFirst = wordCount >= 3;
  const lyricSection = (): ResultRow[] =>
    lyricRows(
      visibleLyrics,
      visibleGenius,
      lyricsExpanded,
      language,
      lyricsFirst ? onlineStatus : null,
    );
  if (lyricsFirst) rows.push(...lyricSection());
  const ytArtists = yt?.artists ?? NO_YT_ARTISTS;
  const ytAlbums = yt?.albums ?? NO_YT_ALBUMS;
  const ytSongRow = (song: NativeYtSong, top: boolean): ResultRow => ({
    type: "ytSong",
    key: `${top ? "top:" : ""}yt:${song.videoId}`,
    song,
    top,
  });
  const hitRow = (hit: SearchHit, top: boolean): ResultRow => ({
    type: "hit",
    key: `${top ? "top:" : ""}${hitKey(hit)}`,
    hit,
    top,
    artistSongs:
      hit.kind === "artist" && topArtist?.artistId === hit.artist.id ? topArtist.songs : null,
  });
  const placedRow = (row: PlacedYtSong, top: boolean): ResultRow =>
    row.source === "library" ? hitRow(songHit(row.track), top) : ytSongRow(row.song, top);
  const ytTopRow = (top: YtSearchTop<NativeYtSong>): ResultRow => {
    switch (top.kind) {
      case "artist":
        return ytArtistRow(top.artist, true);
      case "album":
        return ytAlbumRow(top.album, true);
      case "song": {
        const row = placed[rowOf.get(top.song.videoId) ?? -1];
        // YT Music's best is one of the songs shown, so it has a row; if not, its own.
        return row === undefined ? ytSongRow(top.song, true) : placedRow(row, true);
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
        return placed.map((row) => placedRow(row, false));
      default:
        return [];
    }
  };
  const ytTop = yt?.top ?? null;
  if (results.top !== null) {
    rows.push(
      { type: "heading", key: "heading:top", label: catalogueOf(language).playbackText.topResult },
      hitRow(results.top, true),
    );
  } else if (ytTop !== null) {
    rows.push(
      { type: "heading", key: "heading:top", label: catalogueOf(language).playbackText.topResult },
      ytTopRow(ytTop),
    );
  }
  const afterTopResult = rows.length;
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
      label: `${labels(language)[group.kind]} · ${formatNumber(language, total)}`,
    });
    const groupRows: ResultRow[] = [...group.items.map((hit) => hitRow(hit, false)), ...extra];
    const open = expanded.has(group.kind) || groups.length === 1;
    const shown = open ? groupRows : groupRows.slice(0, PREVIEW[group.kind]);
    rows.push(...shown);
    if (shown.length < total && !open)
      rows.push({ type: "more", key: `more:${group.kind}`, kind: group.kind, total });
    else if (shown.length < total)
      rows.push({ type: "capped", key: `capped:${group.kind}`, shown: shown.length, total });
    if (group.kind === "song" && !lyricsFirst) rows.push(...lyricSection());
  }
  if (!lyricsFirst && !groups.some((group) => group.kind === "song"))
    rows.splice(afterTopResult, 0, ...lyricSection());
  return rows;
};

/** The line standing in for the library's results when nothing in it matches. */
export const noLibraryResultsRow = (query: string, language: AppLanguage = "en"): ResultRow => ({
  type: "note",
  key: "note:library",
  text: catalogueOf(language).playbackText.nothingInYourLibraryMatchesValue(query.trim()),
});

/** Online's quiet lines. */
const ytNotes = (language: AppLanguage): Readonly<Record<YtSectionNote, string>> => ({
  noMatches: catalogueOf(language).playbackText.nothingOnlineMatches,
  allInLibrary: catalogueOf(language).playbackText.everythingFoundOnlineIsAlreadyInYourLibrary,
  offline: catalogueOf(language).playbackText.youreOfflineTapOnlineToTryAgainWhenYoureBackOnline,
  failed: catalogueOf(language).playbackText.couldntSearchOnlineTapOnlineToTryAgain,
});

/**
 * What follows the Library's results for Online: skeleton rows while the
 * query loads (where its results will go), else its quiet line, if any.
 */
export const ytFooterRows = (
  view: YtSectionView<NativeYtSong> | null,
  language: AppLanguage = "en",
): ResultRow[] => {
  if (view === null) return [];
  if (view.loading) return [{ type: "skeleton", key: "skeleton:yt" }];
  return view.note === null
    ? []
    : [{ type: "note", key: "note:yt", text: ytNotes(language)[view.note] }];
};
