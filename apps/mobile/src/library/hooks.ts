import * as Effect from "effect/Effect";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";

import { WaveNative } from "@/native/waveNative";
import { playHistoryVersion } from "@/playback/PlayHistory";

import type { LibraryCounts } from "./db/counts";
import type { HomeSections } from "./db/playHistory";
import { libraryVersion, scanState, type ScanState } from "./LibraryScan";
import {
  LibraryStore,
  type AlbumDetail,
  type AlbumRow,
  type ArtistDetail,
  type ArtistRow,
  type FolderDetail,
  type FolderRow,
  type GenreDetail,
  type GenreRow,
  type LibraryStoreError,
  type PlaylistDetail,
  type PlaylistRow,
  type ScanRootSummary,
  type SongRow,
} from "./LibraryStore";
import { useFavoritesSaved } from "./favorites";
import { usePlaylistsVersion } from "./playlists";
import { appRuntime } from "./runtime";

export const useScanState = (): ScanState =>
  useSyncExternalStore(scanState.subscribe, scanState.get);

/**
 * Whether Wave holds all-files access. Re-checked whenever the app comes back
 * to the foreground, which is how a grant from system settings is noticed.
 */
export const useAllFilesAccess = (): {
  readonly granted: boolean;
  /** True once the user went to settings and came back without granting access. */
  readonly denied: boolean;
  readonly request: () => void;
} => {
  const [granted, setGranted] = useState(() => WaveNative.hasAllFilesAccess());
  const [denied, setDenied] = useState(false);
  const requested = useRef(false);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      const now = WaveNative.hasAllFilesAccess();
      setGranted(now);
      if (requested.current && !now) setDenied(true);
      requested.current = false;
    });
    return () => subscription.remove();
  }, []);

  const request = useCallback(() => {
    requested.current = true;
    void WaveNative.requestAllFilesAccess();
  }, []);

  return { granted, denied, request };
};

const REQUERY_INTERVAL_MS = 1500;

/**
 * Runs a store query and re-runs it when scan batches land, at most every
 * 1.5 s so a large first scan doesn't re-query on every batch.
 */
const useLibraryQuery = <A>(
  query: Effect.Effect<A, LibraryStoreError, LibraryStore>,
  initial: A,
  /** Changes when the owner edits what the query reads (a playlist, a star): re-run at once. */
  edits = 0,
): A => {
  const [value, setValue] = useState(initial);
  const version = useSyncExternalStore(libraryVersion.subscribe, libraryVersion.get);
  const lastRun = useRef(0);
  const lastEdits = useRef(edits);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const run = () => {
      lastRun.current = Date.now();
      appRuntime
        .runPromise(query)
        .then((result) => {
          // A newer version may already be pending; this result is still the freshest one we have.
          if (mounted.current) setValue(result);
        })
        .catch(() => {
          // Keep showing the last good result; scan errors surface in the banner.
        });
    };
    const edited = edits !== lastEdits.current;
    lastEdits.current = edits;
    const wait = edited ? 0 : lastRun.current + REQUERY_INTERVAL_MS - Date.now();
    if (wait <= 0) {
      run();
      return undefined;
    }
    const timer = setTimeout(run, wait);
    return () => clearTimeout(timer);
  }, [query, version, edits]);

  return value;
};

const listSongs = Effect.gen(function* () {
  const store = yield* LibraryStore;
  return yield* store.listSongs;
});

const countTracks = Effect.gen(function* () {
  const store = yield* LibraryStore;
  return yield* store.countTracks;
});

const NO_SONGS: readonly SongRow[] = [];

export const useSongs = (): readonly SongRow[] => useLibraryQuery(listSongs, NO_SONGS);

/** Number of tracks in the library, or null before the first count arrives. */
export const useTrackCount = (): number | null => useLibraryQuery<number | null>(countTracks, null);

const countLibrary = LibraryStore.use((store) => store.countLibrary);

/**
 * How many items each Library entry holds, or undefined before the first count
 * arrives. Re-counted as soon as a playlist is edited or a star is saved.
 */
export const useLibraryCounts = (): LibraryCounts | undefined =>
  useLibraryQuery<LibraryCounts | undefined>(
    countLibrary,
    undefined,
    // Both only ever go up, so their sum changes whenever either does.
    usePlaylistsVersion() + useFavoritesSaved(),
  );

const countSectionSongs = LibraryStore.use((store) => store.countSectionSongs);

/**
 * How many songs each Library entry's menu acts on, or undefined before the
 * first count arrives. Re-counted as `useLibraryCounts` is.
 */
export const useSectionSongCounts = (): LibraryCounts | undefined =>
  useLibraryQuery<LibraryCounts | undefined>(
    countSectionSongs,
    undefined,
    usePlaylistsVersion() + useFavoritesSaved(),
  );

const listRoots = Effect.gen(function* () {
  const store = yield* LibraryStore;
  return yield* store.listRoots;
});

const NO_ROOTS: readonly ScanRootSummary[] = [];

/** The music folders Wave indexes, with their song counts. */
export const useScanRoots = (): readonly ScanRootSummary[] => useLibraryQuery(listRoots, NO_ROOTS);

const listAlbums = LibraryStore.use((store) => store.listAlbums);
const listArtists = LibraryStore.use((store) => store.listArtists);
const listGenres = LibraryStore.use((store) => store.listGenres);
const listFolders = LibraryStore.use((store) => store.listFolders);

const NO_ALBUMS: readonly AlbumRow[] = [];
const NO_ARTISTS: readonly ArtistRow[] = [];
const NO_GENRES: readonly GenreRow[] = [];
const NO_FOLDERS: readonly FolderRow[] = [];

export const useAlbums = (): readonly AlbumRow[] => useLibraryQuery(listAlbums, NO_ALBUMS);
export const useArtists = (): readonly ArtistRow[] => useLibraryQuery(listArtists, NO_ARTISTS);
export const useGenres = (): readonly GenreRow[] => useLibraryQuery(listGenres, NO_GENRES);
export const useFolders = (): readonly FolderRow[] => useLibraryQuery(listFolders, NO_FOLDERS);

/**
 * A detail screen's data: `undefined` while loading, `null` once the item is
 * gone from the library (removed folder, deleted files).
 */
const useDetail = <A>(
  id: number,
  get: (store: LibraryStore["Service"], id: number) => Effect.Effect<A | null, LibraryStoreError>,
): A | null | undefined => {
  const query = useMemo(() => LibraryStore.use((store) => get(store, id)), [get, id]);
  return useLibraryQuery<A | null | undefined>(query, undefined);
};

const getAlbum = (store: LibraryStore["Service"], id: number) => store.getAlbum(id);
const getArtist = (store: LibraryStore["Service"], id: number) => store.getArtist(id);
const getGenre = (store: LibraryStore["Service"], id: number) => store.getGenre(id);
const getFolder = (store: LibraryStore["Service"], id: number) => store.getFolder(id);

export const useAlbum = (id: number): AlbumDetail | null | undefined => useDetail(id, getAlbum);
export const useArtist = (id: number): ArtistDetail | null | undefined => useDetail(id, getArtist);
export const useGenre = (id: number): GenreDetail | null | undefined => useDetail(id, getGenre);
export const useFolder = (id: number): FolderDetail | null | undefined => useDetail(id, getFolder);

const listExcludedFolders = LibraryStore.use((store) => store.excludedFolders);

const NO_EXCLUDED_FOLDERS: readonly string[] = [];

/** The folders inside the music folders that Wave ignores. */
export const useExcludedFolders = (): readonly string[] =>
  useLibraryQuery(listExcludedFolders, NO_EXCLUDED_FOLDERS);

const listPlaylists = LibraryStore.use((store) => store.listPlaylists);
const listFavorites = LibraryStore.use((store) => store.listFavorites);

const NO_PLAYLISTS: readonly PlaylistRow[] = [];

/** Library › Playlists, refreshed as soon as a playlist is edited. */
export const usePlaylists = (): readonly PlaylistRow[] =>
  useLibraryQuery(listPlaylists, NO_PLAYLISTS, usePlaylistsVersion());

/** A playlist screen's data (see `useDetail`), refreshed as soon as it is edited. */
export const usePlaylist = (id: number): PlaylistDetail | null | undefined => {
  const query = useMemo(() => LibraryStore.use((store) => store.getPlaylist(id)), [id]);
  return useLibraryQuery<PlaylistDetail | null | undefined>(
    query,
    undefined,
    usePlaylistsVersion(),
  );
};

/** Library › Favorites: starred songs, most recently starred first. */
export const useFavoriteSongs = (): readonly SongRow[] | undefined =>
  useLibraryQuery<readonly SongRow[] | undefined>(listFavorites, undefined, useFavoritesSaved());

const readHome = LibraryStore.use((store) => store.home);

/**
 * The Home tab's sections, or undefined while loading. Re-read as soon as a
 * play starts or ends, or a star is saved.
 */
export const useHome = (): HomeSections | undefined => {
  const plays = useSyncExternalStore(playHistoryVersion.subscribe, playHistoryVersion.get);
  return useLibraryQuery<HomeSections | undefined>(
    readHome,
    undefined,
    plays + useFavoritesSaved(),
  );
};
