import {
  compareSongReadOrder,
  createSearchCatalog,
  createSearchIndexFollower,
  LIBRARY_QUERY_LIMITS,
  libraryArtistFinder,
  libraryReleaseFinder,
  type SearchIndex,
  type YtArtistAlbum,
  type YtArtistCandidate,
  type YtSearchLibrary,
  type YtSong,
} from "@wave/core";
import type * as Effect from "effect/Effect";
import { useEffect, useMemo } from "react";

import { inSlice, whenFree } from "@/lib/backgroundWork";
import { useStoreWhile } from "@/lib/storeWhile";
import { libraryListQueries } from "@/library/hooks";
import { onLibraryChange } from "@/library/libraryChanges";
import { publishLibraryRows } from "@/library/libraryRows";
import { LibraryStore, type LibraryStoreError } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";
import type { AlbumRow, ArtistRow, GenreRow, PlaylistRow, SongRow } from "@wave/client";
import { perfMark, registerPerfMeta } from "@/perf/perf";
import { libraryFinderOver, type FindInLibrary } from "@/ytmusic/libraryFinder";

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

type Source = "artists" | "albums" | "songs" | "playlists" | "genres";

/**
 * One catalog for the app, kept for the whole session (#1354): opening Search
 * and typing read nothing from the Library. Each source is prepared once, and
 * a change prepares only the rows whose search text it changed (Core's
 * `createSearchCatalog`, rows given with their ids). Its sources keep the
 * order they always had, which ranks ties.
 */
const catalog = createSearchCatalog<Source, SearchHit>([
  "artists",
  "albums",
  "songs",
  "playlists",
  "genres",
]);

/** How each source is read whole (the Library tabs' reads, off the JS thread since #1348) and found. */
const SOURCES = {
  songs: { query: libraryListQueries.songs, hit: songHit },
  albums: { query: libraryListQueries.albums, hit: albumHit },
  artists: { query: libraryListQueries.artists, hit: artistHit },
  genres: { query: libraryListQueries.genres, hit: genreHit },
  playlists: { query: libraryListQueries.playlists, hit: playlistHit },
} as const satisfies Record<Source, unknown>;

const idOf = (row: { readonly id: number }): number => row.id;

/** A source's rows, as the catalog takes them: each with its id. */
type Rows = readonly { readonly id: number }[];

/**
 * When the index reads (Core's `createSearchIndexFollower`): every source
 * once, then each edit's sources at once; a scan batch's or a download's
 * songs patched in by id, the rest of a burst at most once per throttle.
 * Songs are read first, so a search finds songs soonest.
 */
const follower = createSearchIndexFollower<Source>({
  sources: {
    songs: SOURCES.songs.query.reads,
    artists: SOURCES.artists.query.reads,
    albums: SOURCES.albums.query.reads,
    playlists: SOURCES.playlists.query.reads,
    genres: SOURCES.genres.query.reads,
  },
  patchable: "songs",
  throttleMs: LIBRARY_QUERY_LIMITS.throttleMs,
});

/** Entries prepared per step, and how long a run of steps may hold the JS thread. */
const STEP_ENTRIES = 250;
const SLICE_MS = 6;

/** What screens are shown: the index, and the rows it was built from. */
interface Shown {
  readonly index: SearchIndex<SearchHit>;
  readonly songs: readonly SongRow[];
  readonly artists: readonly ArtistRow[];
  readonly albums: readonly AlbumRow[];
}

const NO_SONGS: readonly SongRow[] = [];
const NO_ARTISTS: readonly ArtistRow[] = [];
const NO_ALBUMS: readonly AlbumRow[] = [];

const listeners = new Set<() => void>();
let shown: Shown | null = null;
let preparingScheduled = false;
let followScheduled = false;
let followTimer: ReturnType<typeof setTimeout> | null = null;
let started = false;

const rowsOf = <R>(source: Source, none: readonly R[]): readonly R[] =>
  (catalog.rows(source) as readonly R[] | null) ?? none;

/** Publishes the catalog's rows as the Library in memory (`libraryRows.ts`, #1352). */
const showRows = (): void => {
  const songs = catalog.rows("songs") as readonly SongRow[] | null;
  const albums = catalog.rows("albums") as readonly AlbumRow[] | null;
  const artists = catalog.rows("artists") as readonly ArtistRow[] | null;
  const genres = catalog.rows("genres") as readonly GenreRow[] | null;
  if (songs === null || albums === null || artists === null || genres === null) return;
  publishLibraryRows({ songs, albums, artists, genres });
};

/** Shows the catalog's index as it is now, telling the screens when it changed. */
const showIndex = (): void => {
  showRows();
  const index = catalog.index();
  if (index === (shown?.index ?? null)) return;
  shown =
    index === null
      ? null
      : {
          index,
          songs: rowsOf("songs", NO_SONGS),
          artists: rowsOf("artists", NO_ARTISTS),
          albums: rowsOf("albums", NO_ALBUMS),
        };
  if (index !== null)
    perfMark("search.index", `${catalog.stats().entries}${catalog.complete() ? "" : " partial"}`);
  for (const listener of listeners) listener();
};

/**
 * Prepares what changed a slice at a time, each slice a free turn of the
 * background scheduler (#1350), so a touch, a keystroke or a tap's transition
 * waiting on the JS thread goes first.
 */
const prepareSlice = (): void => {
  preparingScheduled = false;
  const sliceStart = performance.now();
  let more = true;
  while (more && performance.now() - sliceStart < SLICE_MS) more = catalog.work(STEP_ENTRIES);
  showIndex();
  if (more) schedulePreparing();
};

const schedulePreparing = (): void => {
  if (preparingScheduled) return;
  preparingScheduled = true;
  whenFree(prepareSlice, "Search index");
};

/** Reads [source] whole and gives the catalog its rows. */
const readSource = async (source: Source): Promise<void> => {
  const { query, hit } = SOURCES[source];
  const read = query.read as Effect.Effect<Rows, LibraryStoreError, LibraryStore>;
  const rows = await appRuntime.runPromise(read);
  inSlice("Search index reads", () =>
    catalog.update(source, rows, hit as (row: Rows[number]) => SearchHit, idOf),
  );
};

/** Reads the songs [ids] and puts them in their place: a burst asks no whole read of the songs. */
const patchSongs = async (ids: readonly number[]): Promise<void> => {
  const rows = await appRuntime.runPromise(
    // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
    LibraryStore.use((store) => store.songsWithIds(ids)),
  );
  inSlice("Search index reads", () => catalog.patch("songs", rows, compareSongReadOrder));
};

const scheduleFollow = (): void => {
  if (followScheduled || !started) return;
  followScheduled = true;
  whenFree(follow, "Search index reads");
};

/** Runs the follower's next job on a free turn, then the one after; waits when the next is due later. */
const follow = (): void => {
  followScheduled = false;
  if (!started) return;
  const job = follower.next(Date.now());
  if (job === null) return;
  if ("wait" in job) {
    if (followTimer === null)
      followTimer = setTimeout(() => {
        followTimer = null;
        scheduleFollow();
      }, job.wait);
    return;
  }
  const run = job.kind === "read" ? readSource(job.source) : patchSongs(job.ids);
  void run.then(
    () => {
      follower.done(job, Date.now(), true);
      schedulePreparing();
      scheduleFollow();
    },
    () => {
      follower.done(job, Date.now(), false);
      scheduleFollow();
    },
  );
};

/**
 * Builds the index and keeps it current with the Library from then on: a
 * startup job after the first screen settles (`app/_layout.tsx`); Search
 * wanted before that starts it at once. Returns how to stop following.
 */
export const startSearchIndex = (): (() => void) => {
  if (started) return () => {};
  started = true;
  const stop = onLibraryChange((change) => {
    follower.change(change, Date.now());
    scheduleFollow();
  });
  scheduleFollow();
  return () => {
    stop();
    started = false;
    if (followTimer !== null) clearTimeout(followTimer);
    followTimer = null;
  };
};

const subscribeIndex = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const currentShown = (): Shown | null => shown;
const shownIndex = { subscribe: subscribeIndex, get: currentShown };

registerPerfMeta("search", () => ({
  ...catalog.stats(),
  complete: catalog.complete(),
  read: follower.ready(),
}));

/**
 * What Search looks things up in: the library's index, and what the library
 * already has of YT Music's songs, artists and albums.
 */
export interface LibrarySearch {
  readonly index: SearchIndex<SearchHit>;
  readonly library: YtSearchLibrary<YtSong>;
  /** Current Library rows, for joining indexed lyric candidates to playable songs. */
  readonly songs: readonly SongRow[];
  /** The Library song a YT Music song already is: it follows a download at once. */
  readonly find: FindInLibrary;
}

/** Built on first use: most searches never ask YT Music. */
const lazily = <A>(build: () => A): (() => A) => {
  let built: { readonly value: A } | null = null;
  return () => (built ??= { value: build() }).value;
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
 * The search index over the library, kept in memory for the session
 * (#1354), or null until its first source is read and prepared.
 *
 * - Opening Search and typing read nothing from the Library: the index
 *   follows the Library itself from startup (`startSearchIndex`). [active]
 *   only starts it early, when Search is wanted before startup work began.
 * - Until every source is prepared it finds what the prepared ones hold, and
 *   fills in.
 * - Whether a YT Music song is in the Library is the shared finder over the
 *   index's songs; whether it has an artist or album, lookups over its
 *   artists and albums, each built on first use.
 * - Typing only ever runs the (prepared, narrowing) search itself.
 * - While not [following] it gives null and doesn't render for the index's
 *   changes: a scan republishes it per batch, and Search with nothing typed
 *   has no use for it (#1438). Following again gives the current one at once.
 */
export const useSearchIndex = (active: boolean, following = true): LibrarySearch | null => {
  useEffect(() => {
    if (active && !started) startSearchIndex();
  }, [active]);

  const current = useStoreWhile(shownIndex, following, null);
  const songs = current?.songs;
  const artists = current?.artists;
  const albums = current?.albums;
  const find = useMemo(() => (songs === undefined ? null : libraryFinderOver(songs)), [songs]);
  const releases = useMemo(
    () => (artists === undefined || albums === undefined ? null : releasesOf(artists, albums)),
    [artists, albums],
  );

  return useMemo(
    () =>
      current === null || find === null || releases === null
        ? null
        : {
            index: current.index,
            songs: current.songs,
            library: { hasSong: (song: YtSong) => find(song) !== null, ...releases },
            find,
          },
    [current, find, releases],
  );
};
