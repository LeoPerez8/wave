import {
  createSearchCatalog,
  libraryArtistFinder,
  libraryFinder,
  libraryReleaseFinder,
  type SearchIndex,
  type YtArtistAlbum,
  type YtArtistCandidate,
  type YtSearchLibrary,
  type YtSong,
} from "@wave/core";
import { useEffect, useMemo, useSyncExternalStore } from "react";

import { libraryListQueries } from "@/library/hooks";
import type { AlbumRow, ArtistRow, GenreRow, PlaylistRow, SongRow } from "@/library/LibraryStore";
import { useLibraryQuery } from "@/library/sharedQueries";
import { perfMark, registerPerfMeta } from "@/perf/perf";
import type { FindInLibrary } from "@/ytmusic/libraryFinder";

/** Something search found, with the row the screens need to show and open it. */
export type SearchHit =
  | { readonly kind: "artist"; readonly name: string; readonly artist: ArtistRow }
  | {
      readonly kind: "album";
      readonly name: string;
      readonly also: readonly string[];
      readonly album: AlbumRow;
    }
  | {
      readonly kind: "song";
      readonly name: string;
      readonly also: readonly string[];
      readonly song: SongRow;
    }
  | { readonly kind: "playlist"; readonly name: string; readonly playlist: PlaylistRow }
  | { readonly kind: "genre"; readonly name: string; readonly genre: GenreRow };

/** A Library song as search finds it. */
export const songHit = (song: SongRow): SearchHit => ({
  kind: "song",
  name: song.title,
  also: [song.artist, song.album],
  song,
});

const artistHit = (artist: ArtistRow): SearchHit => ({ kind: "artist", name: artist.name, artist });
const albumHit = (album: AlbumRow): SearchHit => ({
  kind: "album",
  name: album.title,
  also: [album.albumArtist],
  album,
});
const playlistHit = (playlist: PlaylistRow): SearchHit => ({
  kind: "playlist",
  name: playlist.name,
  playlist,
});
const genreHit = (genre: GenreRow): SearchHit => ({ kind: "genre", name: genre.name, genre });

/**
 * One catalog for the app, so the index outlives the screen: each source is
 * prepared once per read of it (Core's `createSearchCatalog`), and a change
 * reaching one source (a playlist edit, an import filling a playlist)
 * prepares that source again, not the whole Library.
 */
const catalog = createSearchCatalog<
  "artists" | "albums" | "songs" | "playlists" | "genres",
  SearchHit
>(["artists", "albums", "songs", "playlists", "genres"]);

/** Entries prepared per step, and how long a run of steps may hold the JS thread. */
const STEP_ENTRIES = 250;
const SLICE_MS = 6;

const listeners = new Set<() => void>();
let shownIndex: SearchIndex<SearchHit> | null = null;
let scheduled = false;

/**
 * Prepares what changed a slice at a time, each slice a separate task, so a
 * touch or a keystroke waiting on the JS thread goes in between.
 */
const prepareSlice = (): void => {
  scheduled = false;
  const started = performance.now();
  let more = true;
  while (more && performance.now() - started < SLICE_MS) more = catalog.work(STEP_ENTRIES);
  const index = catalog.index();
  if (index !== shownIndex) {
    shownIndex = index;
    perfMark("search.index", String(catalog.stats().entries));
    for (const listener of listeners) listener();
  }
  if (more) schedulePreparing();
};

const schedulePreparing = (): void => {
  if (scheduled) return;
  scheduled = true;
  setTimeout(prepareSlice, 0);
};

const subscribeIndex = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const currentIndex = (): SearchIndex<SearchHit> | null => shownIndex;

registerPerfMeta("search", () => ({ ...catalog.stats() }));

/**
 * What Search looks things up in: the library's index, and what the library
 * already has of YT Music's songs, artists and albums.
 */
export interface LibrarySearch {
  readonly index: SearchIndex<SearchHit>;
  readonly library: YtSearchLibrary<YtSong>;
  /** The Library song a YT Music song already is: it follows a download at once. */
  readonly find: FindInLibrary;
}

/** Built on first use: most searches never ask YT Music. */
const lazily = <A>(build: () => A): (() => A) => {
  let built: { readonly value: A } | null = null;
  return () => (built ??= { value: build() }).value;
};

/** Whether the library has a YT Music song (Core's `libraryFinder`), built on first use. */
const finderOf = (songs: readonly SongRow[]): FindInLibrary => {
  const finder = lazily(() => libraryFinder(songs));
  return (song) => finder()(song);
};

/** Whether the library has a YT Music artist or album (Core's `libraryArtistFinder`, `libraryReleaseFinder`). */
const releasesOf = (
  artists: readonly ArtistRow[],
  albums: readonly AlbumRow[],
): Pick<YtSearchLibrary<YtSong>, "hasArtist" | "hasAlbum"> => {
  const artistNamed = lazily(() => libraryArtistFinder(artists));
  const albumOf = lazily(() => libraryReleaseFinder(artistNamed(), albums));
  return {
    hasArtist: (artist: YtArtistCandidate) => artistNamed()(artist.name) !== null,
    hasAlbum: (album: YtArtistAlbum) => albumOf()(album) !== null,
  };
};

/**
 * The search index over the whole library, or null until it's first built.
 *
 * - Its five sources are the Library's shared queries (the Library tabs'
 *   reads): asked only once [active] (Search wants them; the screen keeps
 *   asking for as long as it is mounted), re-read only when a Library change
 *   reaches them (a scan or an edit for every source, a playlist edit for
 *   the playlists alone), and while Search is out of sight only for edits.
 * - The index is prepared in short slices between other work, and source by
 *   source: a changed source alone is prepared again.
 * - Typing only ever runs the (prepared, narrowing) search itself.
 */
export const useSearchIndex = (active: boolean): LibrarySearch | null => {
  const queries = active ? libraryListQueries : null;
  const songs = useLibraryQuery(queries?.songs ?? null, null);
  const albums = useLibraryQuery(queries?.albums ?? null, null);
  const artists = useLibraryQuery(queries?.artists ?? null, null);
  const genres = useLibraryQuery(queries?.genres ?? null, null);
  const playlists = useLibraryQuery(queries?.playlists ?? null, null);

  useEffect(() => {
    if (songs !== null) catalog.update("songs", songs, songHit);
    if (albums !== null) catalog.update("albums", albums, albumHit);
    if (artists !== null) catalog.update("artists", artists, artistHit);
    if (genres !== null) catalog.update("genres", genres, genreHit);
    if (playlists !== null) catalog.update("playlists", playlists, playlistHit);
    schedulePreparing();
  }, [songs, albums, artists, genres, playlists]);

  const index = useSyncExternalStore(subscribeIndex, currentIndex);
  const find = useMemo(() => (songs === null ? null : finderOf(songs)), [songs]);
  const releases = useMemo(
    () => (artists === null || albums === null ? null : releasesOf(artists, albums)),
    [artists, albums],
  );

  return useMemo(
    () =>
      index === null || find === null || releases === null
        ? null
        : {
            index,
            library: { hasSong: (song: YtSong) => find(song) !== null, ...releases },
            find,
          },
    [index, find, releases],
  );
};
