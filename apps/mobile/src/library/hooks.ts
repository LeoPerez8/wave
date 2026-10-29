import { useLocalisation } from "@/localisation/localisation";
import {
  statsFacts,
  summedListeningTotals,
  type CollectionKind,
  type LibraryReads,
  type StatsFacts,
  type ListeningSums,
  type MissingTrack,
} from "@wave/core";
import * as Effect from "effect/Effect";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";

import { WaveNative } from "@/native/waveNative";
import { homeContent, type HomeContent } from "@/home/homeOpening";
import { useSightedStore } from "@/lib/screenSight";
import { createAllFilesAccess, type AllFilesAccessState } from "./allFilesAccess";

import type { LibraryCounts } from "./db/counts";
import type { LinkRows } from "./db/links";
import type { HomePlays, HomeSections } from "./db/playHistory";
import { scanState, type ScanState } from "./LibraryScan";
import { homeReads } from "./homeReads";
import {
  LibraryStore,
  type AlbumDetail,
  type AlbumRow,
  type ArtistDetail,
  type ArtistRow,
  type FavoriteRow,
  type GenreRow,
  type LibraryStoreError,
  type PlaylistDetail,
  type PlaylistRow,
  type ScanRootSummary,
  type SongRow,
} from "./LibraryStore";
import { knownPlaylists, listPlaylistsRemembered } from "./playlists";
import { appRuntime } from "./runtime";
import { libraryQuery, useLibraryQuery, type LibraryQuery } from "./sharedQueries";

export { libraryQuery, useLibraryQuery } from "./sharedQueries";

const scanStatusNow = (): ScanState["status"] => scanState.get().status;

/**
 * Whether a scan runs, ended or failed, without its progress: a scan's
 * progress re-renders only the banner (`useScanProgress`). A screen out of
 * sight doesn't follow it.
 */
export const useScanStatus = (): ScanState["status"] =>
  useSightedStore(scanState.subscribe, scanStatusNow);

/** The scan's progress, for `ScanProgressBanner` alone; everything else reads `useScanStatus`. */
export const useScanProgress = (): ScanState => useSightedStore(scanState.subscribe, scanState.get);

/**
 * Whether Wave holds all-files access. Re-checked whenever the app comes back
 * to the foreground, which is how a grant from system settings is noticed.
 */
export const useAllFilesAccess = (): AllFilesAccessState & {
  readonly request: () => Promise<void>;
} => {
  const [access] = useState(() =>
    createAllFilesAccess({
      hasAccess: () => WaveNative.hasAllFilesAccess(),
      openSettings: () => WaveNative.requestAllFilesAccess(),
    }),
  );
  const state = useSyncExternalStore(access.subscribe, access.get);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (appState) => {
      if (appState === "active") access.recheck();
    });
    // Also cover a grant between initial render and listener attachment.
    access.recheck();
    return () => subscription.remove();
  }, [access]);

  return { ...state, request: access.request };
};

/** A query over the tracks and what derives from them (albums, artists, genres, counts). */
const TRACKS: LibraryReads = { tracks: true };

/** Declares a store read as a shared query. */
const storeQuery = <A>(
  key: string,
  reads: LibraryReads,
  read: (store: LibraryStore["Service"]) => Effect.Effect<A, LibraryStoreError>,
): LibraryQuery<A> =>
  // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
  libraryQuery(key, reads, LibraryStore.use(read));

const listMissingSongs = storeQuery("missingSongs", TRACKS, (store) => store.missingSongs());
const NO_MISSING_SONGS: readonly MissingTrack[] = [];

/** The missing songs, by title: the Wave account's songs with no file on this phone. */
export const useMissingSongs = (): readonly MissingTrack[] =>
  useLibraryQuery(listMissingSongs, NO_MISSING_SONGS);

/** The missing songs, or null until they're first read: none read isn't none missing. */
export const useLoadedMissingSongs = (): readonly MissingTrack[] | null =>
  useLibraryQuery<readonly MissingTrack[] | null>(listMissingSongs, null);

const NO_ALBUMS_MISSING_SONGS: readonly (readonly number[])[] = [];

/**
 * Each album of [albumIds]'s missing songs, as Track ids in album order; none
 * until they're read (other albums' answer is never passed off as theirs).
 * No albums ask the Library nothing.
 */
export const useAlbumsMissingSongs = (
  albumIds: readonly number[],
): readonly (readonly number[])[] => {
  // Keyed by the ids, not the array: the same albums in a new array ask nothing again.
  const key = albumIds.join(",");
  const query = useMemo(() => {
    if (key === "") return null;
    const ids = key.split(",").map(Number);
    return storeQuery(`albumsMissingSongs:${key}`, TRACKS, (store) =>
      store.albumsMissingSongs(ids),
    );
  }, [key]);
  return useLibraryQuery(query, NO_ALBUMS_MISSING_SONGS);
};

/** A collection whose Library songs a menu reads (`useCollectionSongs`). */
export type SongsCollection = CollectionKind;

const COLLECTION_SONGS: {
  readonly [K in SongsCollection]: (
    store: LibraryStore["Service"],
    id: number,
  ) => Effect.Effect<readonly SongRow[], LibraryStoreError>;
} = {
  album: (store, id) => store.getAlbum(id).pipe(Effect.map((album) => album?.tracks ?? [])),
  artist: (store, id) => store.getArtist(id).pipe(Effect.map((artist) => artist?.songs ?? [])),
  genre: (store, id) => store.getGenre(id).pipe(Effect.map((genre) => genre?.songs ?? [])),
  // Its Library songs only: a YT Music or unsearched entry has no file.
  playlist: (store, id) =>
    store
      .getPlaylist(id)
      .pipe(
        Effect.map((playlist) =>
          (playlist?.items ?? []).flatMap((entry) =>
            entry.source === "library" ? [entry.track] : [],
          ),
        ),
      ),
};

/**
 * The Library songs of [collection] (missing songs included), or undefined
 * until read; null asks nothing. A menu reads them to tell whether any lacks
 * what Fix Song fills in.
 */
export const useCollectionSongs = (
  collection: { readonly kind: SongsCollection; readonly id: number } | null,
): readonly SongRow[] | undefined => {
  const kind = collection?.kind;
  const id = collection?.id;
  const query = useMemo(
    () => (kind === undefined || id === undefined ? null : collectionSongsQuery(kind, id)),
    [kind, id],
  );
  return useLibraryQuery<readonly SongRow[] | undefined>(query, undefined);
};

const collectionSongsQuery = (kind: SongsCollection, id: number) =>
  storeQuery(
    `collectionSongs:${kind}:${id}`,
    kind === "playlist" ? { playlists: [id], tracks: true } : TRACKS,
    (store) => COLLECTION_SONGS[kind](store, id),
  );

/**
 * The Library songs of the collection [kind] [id], read once: what a menu
 * reads before it opens, so Fix Songs doesn't join it under a finger.
 */
export const readCollectionSongs = (
  kind: SongsCollection,
  id: number,
): Promise<readonly SongRow[]> => appRuntime.runPromise(collectionSongsQuery(kind, id).read);

const listSongs = storeQuery("songs", TRACKS, (store) => store.listSongs);
const countTracks = storeQuery("trackCount", TRACKS, (store) => store.countTracks);

/** Number of tracks in the library, or null before the first count arrives. */
export const useTrackCount = (): number | null => useLibraryQuery<number | null>(countTracks, null);

/** What the Library entries count: songs, playlists and Favorites. */
const COUNTED: LibraryReads = { tracks: true, playlists: true, favorites: true };

const countLibrary = storeQuery("libraryCounts", COUNTED, (store) => store.countLibrary);

/**
 * How many items each Library entry holds, or undefined before the first count
 * arrives. Re-counted as soon as a playlist is edited or a star is saved.
 */
export const useLibraryCounts = (): LibraryCounts | undefined =>
  useLibraryQuery<LibraryCounts | undefined>(countLibrary, undefined);

const countSectionSongs = storeQuery(
  "sectionSongCounts",
  COUNTED,
  (store) => store.countSectionSongs,
);

/**
 * How many songs each Library entry's menu acts on, or undefined before the
 * first count arrives. Re-counted as `useLibraryCounts` is.
 */
export const useSectionSongCounts = (): LibraryCounts | undefined =>
  useLibraryQuery<LibraryCounts | undefined>(countSectionSongs, undefined);

const listRoots = storeQuery(
  "scanRoots",
  { folders: true, tracks: true },
  (store) => store.listRoots,
);

const NO_ROOTS: readonly ScanRootSummary[] = [];

/** The music folders Wave indexes, with their song counts. */
export const useScanRoots = (): readonly ScanRootSummary[] => useLibraryQuery(listRoots, NO_ROOTS);

/** Null while the roots load; an empty answer must not stand in for pending content. */
export const useLoadedScanRoots = (): readonly ScanRootSummary[] | null =>
  useLibraryQuery<readonly ScanRootSummary[] | null>(listRoots, null);

const listAlbums = storeQuery("albums", TRACKS, (store) => store.listAlbums);
const listArtists = storeQuery("artists", TRACKS, (store) => store.listArtists);
const listGenres = storeQuery("genres", TRACKS, (store) => store.listGenres);

const NO_ALBUMS: readonly AlbumRow[] = [];
const NO_ARTISTS: readonly ArtistRow[] = [];
const NO_GENRES: readonly GenreRow[] = [];

export const useAlbums = (active = true): readonly AlbumRow[] =>
  useLibraryQuery(active ? listAlbums : null, NO_ALBUMS);
export const useArtists = (active = true): readonly ArtistRow[] =>
  useLibraryQuery(active ? listArtists : null, NO_ARTISTS);
export const useGenres = (): readonly GenreRow[] => useLibraryQuery(listGenres, NO_GENRES);

/**
 * A detail screen's data: `undefined` while loading, `null` once the item is
 * gone from the library (removed folder, deleted files).
 */
const useDetail = <A>(
  kind: string,
  id: number,
  get: (store: LibraryStore["Service"], id: number) => Effect.Effect<A | null, LibraryStoreError>,
): A | null | undefined => {
  const query = useMemo(
    () => storeQuery(`${kind}:${id}`, TRACKS, (store) => get(store, id)),
    [kind, get, id],
  );
  return useLibraryQuery<A | null | undefined>(query, undefined);
};

const getAlbum = (store: LibraryStore["Service"], id: number) => store.getAlbum(id);
const getArtist = (store: LibraryStore["Service"], id: number) => store.getArtist(id);

const NO_LINKS: LinkRows = { album: null, artist: null };

/**
 * The album and artist rows behind links to them (Go to Album / Artist, Now
 * Playing, an album's artist), read ahead of a tap so `openAlbum` /
 * `openArtist` can hand them to the screen for its first frame. Null until
 * read (or for an id not asked for). One targeted read per id: no
 * library-wide count.
 */
export const useLinkRows = (
  albumId: number | undefined,
  artistId: number | undefined,
  active = true,
): LinkRows => {
  const query = useMemo(
    () =>
      storeQuery(`linkRows:${albumId}:${artistId}`, TRACKS, (store) =>
        store.linkRows({ albumId, artistId }),
      ),
    [albumId, artistId],
  );
  return useLibraryQuery(active ? query : null, NO_LINKS);
};

export const useAlbum = (id: number): AlbumDetail | null | undefined =>
  useDetail("album", id, getAlbum);
export const useArtist = (id: number): ArtistDetail | null | undefined =>
  useDetail("artist", id, getArtist);

const listExcludedFolders = storeQuery(
  "excludedFolders",
  { folders: true },
  (store) => store.excludedFolders,
);

/** Null until the exclusions load, distinct from a library with nothing excluded. */
export const useLoadedExcludedFolders = (): readonly string[] | null =>
  useLibraryQuery<readonly string[] | null>(listExcludedFolders, null);

/** Playlists show their songs' titles, lengths and covers, and link YT Music entries on scans. */
const PLAYLISTS: LibraryReads = { playlists: true, tracks: true };

const listPlaylists = libraryQuery("playlists", PLAYLISTS, listPlaylistsRemembered);

const NO_PLAYLISTS: readonly PlaylistRow[] = [];

/**
 * Library › Playlists, refreshed as soon as a playlist is edited. Starts from
 * the remembered list when it is up to date, so a card listing them opens full.
 */
export const usePlaylists = (): readonly PlaylistRow[] =>
  useLibraryQuery(listPlaylists, knownPlaylists() ?? NO_PLAYLISTS);

/**
 * The Library's lists as shared queries, for what reads them as they are
 * (Search's index): the same reads as the Library's tabs, so a screen showing
 * one shares it.
 */
export const libraryListQueries = {
  songs: listSongs,
  albums: listAlbums,
  artists: listArtists,
  genres: listGenres,
  playlists: listPlaylists,
} as const;

/** A playlist screen's data (see `useDetail`), refreshed as soon as it is edited. */
export const usePlaylist = (id: number): PlaylistDetail | null | undefined => {
  const query = useMemo(
    () =>
      storeQuery(`playlist:${id}`, { playlists: [id], tracks: true }, (store) =>
        store.getPlaylist(id),
      ),
    [id],
  );
  return useLibraryQuery<PlaylistDetail | null | undefined>(query, undefined);
};

const listFavorites = storeQuery(
  "favorites",
  { favorites: true, tracks: true },
  (store) => store.listFavorites,
);

/** Library › Favorites: starred songs, most recently starred first. */
export const useFavoriteSongs = (): readonly FavoriteRow[] | undefined =>
  useLibraryQuery<readonly FavoriteRow[] | undefined>(listFavorites, undefined);

// Home's sections by what they read, so a play doesn't re-read Recently Added
// or Favorites, and a star doesn't re-read what plays change.
const readHomeAdded = storeQuery(homeReads.added.key, homeReads.added.reads, homeReads.added.read);
const readHomePlays = storeQuery<HomePlays | undefined>(
  homeReads.plays.key,
  homeReads.plays.reads,
  homeReads.plays.read,
);
const readHomeFavorites = storeQuery(
  homeReads.favorites.key,
  homeReads.favorites.reads,
  homeReads.favorites.read,
);

/**
 * Home's independently answered slices; missing properties are still loading. Each part is re-read
 * only for what changes it: songs added or removed, stars (at once), plays
 * (at most every 1.5 s while Home is in sight; plays while it's hidden are
 * read once when it comes back). Home and Library's shelf share the reads.
 */
export const useHomeContent = (): HomeContent => {
  const added = useLibraryQuery<Pick<HomeSections, "recentlyAdded"> | undefined>(
    readHomeAdded,
    undefined,
  );
  const plays = useLibraryQuery(readHomePlays, undefined);
  const favorites = useLibraryQuery<Pick<HomeSections, "favorites"> | undefined>(
    readHomeFavorites,
    undefined,
  );
  return useMemo(() => homeContent(added, plays, favorites), [added, plays, favorites]);
};

/** Complete snapshot for callers that need all lists (the Library's shelf). */
export const useHome = (): HomeSections | undefined => {
  const home = useHomeContent();
  return home.recentlyAdded === undefined ||
    home.recentlyPlayed === undefined ||
    home.mostPlayed === undefined ||
    home.favorites === undefined
    ? undefined
    : (home as HomeSections);
};

const readListeningSums = storeQuery(
  "listeningSums",
  { tracks: true, plays: true },
  (store) => store.listeningSums,
);

/**
 * Home's Stats facts (library and all-time listening totals), or
 * undefined while loading. The library totals are Library's counts; the
 * listening totals one row of the all-time play totals, re-read after plays
 * (at most every 1.5 s while Home is in sight, else when it comes back) and
 * scan batches.
 */
export const useStatsFacts = (): StatsFacts | undefined => {
 const { language } = useLocalisation();
  const counts = useLibraryCounts();
  const sums = useLibraryQuery<ListeningSums | undefined>(readListeningSums, undefined);
  return useMemo(
    () =>
      counts === undefined || sums === undefined
        ? undefined
        : statsFacts(counts, summedListeningTotals(sums), language),
    [counts, sums, language],
  );
};
