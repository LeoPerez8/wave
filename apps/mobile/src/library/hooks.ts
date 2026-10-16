import {
  listeningOverview,
  listeningTotals,
  type LibraryReads,
  type ListeningOverview,
  type MissingTrack,
} from "@wave/core";
import * as Effect from "effect/Effect";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";

import { WaveNative } from "@/native/waveNative";

import type { LibraryCounts } from "./db/counts";
import type { LinkRows } from "./db/links";
import type { HomeSections } from "./db/playHistory";
import { scanState, type ScanState } from "./LibraryScan";
import {
  LibraryStore,
  type AlbumDetail,
  type AlbumRow,
  type ArtistDetail,
  type ArtistRow,
  type FavoriteRow,
  type GenreDetail,
  type GenreRow,
  type LibraryStoreError,
  type PlaylistDetail,
  type PlaylistRow,
  type ScanRootSummary,
  type SongRow,
} from "./LibraryStore";
import { knownPlaylists, listPlaylistsRemembered } from "./playlists";
import { libraryQuery, useLibraryQuery, type LibraryQuery } from "./sharedQueries";

export { libraryQuery, useLibraryQuery, type LibraryQuery } from "./sharedQueries";

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

const listSongs = storeQuery("songs", TRACKS, (store) => store.listSongs);
const countTracks = storeQuery("trackCount", TRACKS, (store) => store.countTracks);

const NO_SONGS: readonly SongRow[] = [];

export const useSongs = (): readonly SongRow[] => useLibraryQuery(listSongs, NO_SONGS);

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

const listAlbums = storeQuery("albums", TRACKS, (store) => store.listAlbums);
const listArtists = storeQuery("artists", TRACKS, (store) => store.listArtists);
const listGenres = storeQuery("genres", TRACKS, (store) => store.listGenres);

const NO_ALBUMS: readonly AlbumRow[] = [];
const NO_ARTISTS: readonly ArtistRow[] = [];
const NO_GENRES: readonly GenreRow[] = [];

export const useAlbums = (): readonly AlbumRow[] => useLibraryQuery(listAlbums, NO_ALBUMS);
export const useArtists = (): readonly ArtistRow[] => useLibraryQuery(listArtists, NO_ARTISTS);
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
const getGenre = (store: LibraryStore["Service"], id: number) => store.getGenre(id);

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
): LinkRows => {
  const query = useMemo(
    () =>
      storeQuery(`linkRows:${albumId}:${artistId}`, TRACKS, (store) =>
        store.linkRows({ albumId, artistId }),
      ),
    [albumId, artistId],
  );
  return useLibraryQuery(query, NO_LINKS);
};

export const useAlbum = (id: number): AlbumDetail | null | undefined =>
  useDetail("album", id, getAlbum);
export const useArtist = (id: number): ArtistDetail | null | undefined =>
  useDetail("artist", id, getArtist);
export const useGenre = (id: number): GenreDetail | null | undefined =>
  useDetail("genre", id, getGenre);

const listExcludedFolders = storeQuery(
  "excludedFolders",
  { folders: true },
  (store) => store.excludedFolders,
);

const NO_EXCLUDED_FOLDERS: readonly string[] = [];

/** The folders inside the music folders that Wave ignores. */
export const useExcludedFolders = (): readonly string[] =>
  useLibraryQuery(listExcludedFolders, NO_EXCLUDED_FOLDERS);

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

const readHome = storeQuery("home", { tracks: true, favorites: true, plays: true }, (store) =>
  store.home(),
);

/**
 * The Home tab's sections, or undefined while loading. Re-read as soon as a
 * star is saved, and as soon as a play starts or ends while Home is in sight
 * (plays while it's hidden are read when it comes back). Home and Library's
 * shelf share one read.
 */
export const useHome = (): HomeSections | undefined =>
  useLibraryQuery<HomeSections | undefined>(readHome, undefined);

const readListeningOverview = storeQuery(
  "listeningOverview",
  { tracks: true, plays: true },
  (store) =>
    Effect.map(Effect.all([store.countLibrary, store.songListening]), ([counts, songs]) =>
      listeningOverview(counts, listeningTotals(songs)),
    ),
);

/**
 * Home's listening overview (library and all-time listening totals), or
 * undefined while loading. Re-read after scan batches, and as soon as a play
 * starts or ends while Home is in sight (else when it comes back).
 */
export const useListeningOverview = (): ListeningOverview | undefined =>
  useLibraryQuery<ListeningOverview | undefined>(readListeningOverview, undefined);
