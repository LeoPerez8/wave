/**
 * Search over the Library: the phone's index (Core's `createSearchCatalog` over the same five
 * sources, made into the same entries), so a search finds the same results in the same order.
 */
import {
  createSearchCatalog,
  findLyricMatch,
  isLyricPhraseQuery,
  normalizeSearchText,
  songNamedByQuery,
  type SearchCatalog,
  type SearchIndex,
  type SearchKind,
} from "@wave/core";
import type { AlbumRow, ArtistRow, GenreRow, PlaylistRow, SongRow } from "@wave/client";
import type { LibraryDatabase } from "@wave/client/db/database";
import { selectAlbums } from "@wave/client/db/albums";
import {
  databaseWrites,
  listArtistsSync,
  listGenres,
  listSongs,
} from "@wave/client/db/libraryQueries";
import { selectLyricsCandidates } from "@wave/client/db/lyricsSearchIndex";
import { selectPlaylists } from "@wave/client/db/playlists";
import type { BrowseRow } from "../../shared/browse.ts";
import {
  SEARCH_RESULT_LIMIT,
  type LibrarySearchView,
  type LyricsHitView,
  type SearchResult,
} from "../../shared/search.ts";
import { browseRows, browseSongs } from "./browse.ts";

/** What search found: its kind, its Library id, and what finds it (the phone's `SearchHit`). */
interface Hit {
  readonly kind: SearchKind;
  readonly id: number;
  readonly name: string;
  readonly also?: readonly string[];
}

const SOURCES = ["artists", "albums", "songs", "playlists", "genres"] as const;
type Source = (typeof SOURCES)[number];

// The phone's entries (`apps/mobile/src/search/searchIndex.ts`), field for field.
const songHit = (song: SongRow): Hit => ({
  kind: "song",
  id: song.id,
  name: song.title,
  also: [song.artist, song.album],
});
const albumHit = (album: AlbumRow): Hit => ({
  kind: "album",
  id: album.id,
  name: album.title,
  also: [album.albumArtist],
});
const artistHit = (artist: ArtistRow): Hit => ({
  kind: "artist",
  id: artist.id,
  name: artist.name,
});
const playlistHit = (playlist: PlaylistRow): Hit => ({
  kind: "playlist",
  id: playlist.id,
  name: playlist.name,
});
const genreHit = (genre: GenreRow): Hit => ({ kind: "genre", id: genre.id, name: genre.name });

const read = (db: LibraryDatabase): Record<Source, readonly Hit[]> => ({
  artists: listArtistsSync(db).map(artistHit),
  albums: selectAlbums(db, undefined).map(albumHit),
  songs: listSongs(db).map(songHit),
  playlists: selectPlaylists(db).map(playlistHit),
  genres: listGenres(db).map(genreHit),
});

const fingerprint = (hits: readonly Hit[]): string =>
  hits
    .map((hit) => `${hit.id}\u0000${hit.name}\u0000${hit.also?.join("\u0000") ?? ""}`)
    .join("\u0001");

interface Kept {
  /** `databaseWrites` when the sources were last read. */
  writes: string;
  readonly sources: Map<Source, { readonly key: string; readonly hits: readonly Hit[] }>;
  readonly catalog: SearchCatalog<Source, Hit>;
}

const kept = new WeakMap<LibraryDatabase, Kept>();

/**
 * The index over what the Library holds now. Nothing written since the last search reuses it; a
 * write reads the sources again, and only a source whose entries changed is prepared again.
 */
const indexOf = (db: LibraryDatabase): SearchIndex<Hit> => {
  let state = kept.get(db);
  const writes = databaseWrites(db);
  if (state !== undefined && state.writes === writes) {
    const index = state.catalog.index();
    if (index !== null) return index;
  }
  if (state === undefined) {
    state = { writes, sources: new Map(), catalog: createSearchCatalog<Source, Hit>(SOURCES) };
    kept.set(db, state);
  }
  state.writes = writes;
  const sources = read(db);
  for (const source of SOURCES) {
    const key = fingerprint(sources[source]);
    let given = state.sources.get(source);
    if (given?.key !== key) {
      given = { key, hits: sources[source] };
      state.sources.set(source, given);
    }
    state.catalog.update(source, given.hits, (hit) => hit);
  }
  while (state.catalog.work(Number.MAX_SAFE_INTEGER));
  return state.catalog.index()!;
};

const LIST: Readonly<
  Record<Exclude<SearchKind, "song">, "albums" | "artists" | "playlists" | "genres">
> = {
  album: "albums",
  artist: "artists",
  playlist: "playlists",
  genre: "genres",
};

/** The rows [hits] show, in their order; one the Library's list lacks shows its name. */
const rowsOf = (db: LibraryDatabase, kind: SearchKind, hits: readonly Hit[]): BrowseRow[] => {
  const ids = hits.map((hit) => hit.id);
  const found = new Map(
    (kind === "song" ? browseSongs(db, ids) : browseRows(db, LIST[kind], ids)).map((row) => [
      row.id,
      row,
    ]),
  );
  return hits.map(
    (hit) =>
      found.get(hit.id) ?? {
        id: hit.id,
        title: hit.name,
        artist: hit.also?.[0] ?? "",
        album: hit.also?.[1] ?? "",
        artworkHash: null,
        durationMs: 0,
        count: 0,
        year: null,
        genre: null,
        trackNumber: null,
        favorite: false,
        path: null,
        unavailable: false,
      },
  );
};

const NOTHING: LibrarySearchView = {
  query: "",
  top: null,
  groups: [],
  lyrics: [],
  lyricsFirst: false,
  namesSong: false,
};

/**
 * Searches the Library as the phone's Search does: the top result, each type's best matches
 * (at most `SEARCH_RESULT_LIMIT`) in Core's order, and the songs whose lyrics hold the query's
 * words that the Songs group doesn't show.
 */
export const searchLibrary = (db: LibraryDatabase, query: string): LibrarySearchView => {
  const trimmed = query.trim();
  if (normalizeSearchText(trimmed) === "") return { ...NOTHING, query };
  const results = indexOf(db).search(trimmed, { limit: SEARCH_RESULT_LIMIT });
  const groups = results.groups.map((group) => ({
    kind: group.kind,
    items: rowsOf(db, group.kind, group.items),
    total: group.total,
  }));
  // A query naming a song by its title and artist has that song on top (#1470).
  const named = songNamedByQuery(
    trimmed,
    results.groups.find((group) => group.kind === "song")?.items ?? [],
    (hit) => ({ title: hit.name, artists: hit.also?.slice(0, 1) ?? [] }),
  );
  const best = named ?? results.top;
  const top: SearchResult | null =
    best === null ? null : { kind: best.kind, row: rowsOf(db, best.kind, [best])[0]! };
  const shown = new Set(
    results.groups
      .filter((group) => group.kind === "song")
      .flatMap((group) => group.items.map((hit) => hit.id)),
  );
  if (best?.kind === "song") shown.add(best.id);
  const matches = selectLyricsCandidates(db, trimmed).flatMap((candidate) => {
    if (shown.has(candidate.trackId)) return [];
    const match = findLyricMatch(candidate.lyrics, trimmed);
    return match === null ? [] : [{ trackId: candidate.trackId, ...match }];
  });
  const rows = new Map(
    browseSongs(
      db,
      matches.map((match) => match.trackId),
    ).map((row) => [row.id, row]),
  );
  const lyrics: LyricsHitView[] = matches.flatMap(({ trackId, line, ranges }) => {
    const row = rows.get(trackId);
    return row === undefined ? [] : [{ row, line, ranges }];
  });
  return {
    query,
    top,
    groups,
    lyrics,
    lyricsFirst: isLyricPhraseQuery(trimmed, named !== null),
    namesSong: named !== null,
  };
};

/**
 * The songs a search shows, in order: its Songs group, then the songs found by their lyrics.
 * Playing from search plays one of these.
 */
export const searchSongIds = (db: LibraryDatabase, query: string): number[] => {
  const view = searchLibrary(db, query);
  return [
    ...(view.groups.find((group) => group.kind === "song")?.items ?? []),
    ...view.lyrics.map((hit) => hit.row),
  ].map((row) => row.id);
};
