import { sortKey, type PlaylistSong } from "@wave/core";
import * as Effect from "effect/Effect";
import { useSyncExternalStore } from "react";

import { makeExternalStore } from "@/lib/externalStore";

import {
  LibraryStore,
  type LibraryStoreError,
  type PlaylistAddResult,
  type PlaylistRow,
} from "./LibraryStore";
import { appRuntime } from "./runtime";

/** Bumped after every playlist edit; playlist queries re-run on it straight away. */
const playlistsVersion = makeExternalStore(0);

export const usePlaylistsVersion = (): number =>
  useSyncExternalStore(playlistsVersion.subscribe, playlistsVersion.get);

const edit = <A>(
  run: (store: LibraryStore["Service"]) => Effect.Effect<A, LibraryStoreError>,
): Promise<A> =>
  // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
  appRuntime.runPromise(LibraryStore.use(run)).finally(() => {
    playlistsVersion.update((version) => version + 1);
    // Re-read now, so the next card that lists them doesn't wait for it.
    appRuntime.runPromise(listPlaylistsRemembered).catch(() => {});
  });

/** The playlists as last read, and the `playlistsVersion` they were read at. */
let remembered: { readonly version: number; readonly rows: readonly PlaylistRow[] } | undefined;

/**
 * Lists the playlists and remembers them, so cards that list them (Add to
 * Playlist) or check names against them (the name prompt) open at once.
 */
export const listPlaylistsRemembered: Effect.Effect<
  readonly PlaylistRow[],
  LibraryStoreError,
  LibraryStore
> = Effect.gen(function* () {
  // Read before the query: an edit landing meanwhile leaves these rows out of date.
  const version = playlistsVersion.get();
  const store = yield* LibraryStore;
  const rows = yield* store.listPlaylists;
  remembered = { version, rows };
  return rows;
});

/**
 * Reads the playlists once at app start, so the first New Playlist prompt or
 * Add to Playlist card of the session opens at once too. Safe to call repeatedly.
 */
export const primePlaylists = (): void => {
  if (knownPlaylists() === undefined) {
    appRuntime.runPromise(listPlaylistsRemembered).catch(() => {});
  }
};

/** The playlists, as remembered when no edit has happened since; undefined otherwise. */
export const knownPlaylists = (): readonly PlaylistRow[] | undefined =>
  remembered?.version === playlistsVersion.get() ? remembered.rows : undefined;

/** The playlists: remembered ones at once, else read now. */
export const currentPlaylists = (): Promise<readonly PlaylistRow[]> => {
  const known = knownPlaylists();
  return known === undefined
    ? appRuntime.runPromise(listPlaylistsRemembered)
    : Promise.resolve(known);
};

/** Every playlist's name, for checking a new name with Core's `checkPlaylistName`. */
export const playlistNames = (): Promise<readonly string[]> =>
  currentPlaylists().then((playlists) => playlists.map((playlist) => playlist.name));

/** Library tracks [trackIds] as songs a playlist holds (Core's `PlaylistSong`). */
export const libraryPlaylistSongs = (trackIds: readonly number[]): PlaylistSong[] =>
  trackIds.map((trackId) => ({ source: "library", trackId }));

/**
 * Creates a playlist holding [songs] in that order: Library tracks and YT
 * Music songs the Library doesn't have (streamed until it does), a song given
 * twice going in once.
 */
export const createPlaylist = (
  name: string,
  songs: readonly PlaylistSong[] = [],
): Promise<PlaylistAddResult> => edit((store) => store.createPlaylist(name, songs));

/** A playlist just created empty, as Library › Playlists will list it: for its screen's first frame. */
export const emptyPlaylistRow = (id: number, name: string): PlaylistRow => ({
  id,
  name,
  sort: sortKey(name),
  trackCount: 0,
  durationMs: 0,
  thumbPaths: [],
  artworkPaths: [],
});

export const renamePlaylist = (id: number, name: string): Promise<void> =>
  edit((store) => store.renamePlaylist(id, name));

export const deletePlaylist = (id: number): Promise<void> =>
  edit((store) => store.deletePlaylist(id));

/** Appends [songs] the playlist doesn't hold yet (Core's `planPlaylistSongs`). */
export const addToPlaylist = (
  id: number,
  songs: readonly PlaylistSong[],
): Promise<PlaylistAddResult> => edit((store) => store.addToPlaylist(id, songs));

export const movePlaylistItem = (
  playlistId: number,
  itemId: number,
  toIndex: number,
): Promise<void> => edit((store) => store.movePlaylistItem(playlistId, itemId, toIndex));

/** Makes the playlist hold exactly these songs, in this order (an import's Replace). */
export const replacePlaylistSongs = (
  playlistId: number,
  songs: readonly PlaylistSong[],
): Promise<void> => edit((store) => store.replacePlaylistSongs(playlistId, songs));

/** Removes these entries (not every copy of their songs) from the playlist. */
export const removePlaylistItems = (
  playlistId: number,
  itemIds: readonly number[],
): Promise<void> => edit((store) => store.removePlaylistItems(playlistId, itemIds));
