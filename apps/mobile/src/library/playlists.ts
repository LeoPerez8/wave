import { sortKey, type PlaylistSong } from "@wave/core";
import * as Effect from "effect/Effect";
import { useSyncExternalStore } from "react";

import { makeExternalStore } from "@/lib/externalStore";
import { WaveNative } from "@/native/waveNative";

import {
  LibraryStore,
  type LibraryStoreError,
  type PlaylistAddResult,
  type PlaylistRow,
} from "./LibraryStore";
import { publishLibraryChange } from "./libraryChanges";
import { appRuntime } from "./runtime";

/** Bumped after every playlist edit; playlist queries re-run on it straight away. */
const playlistsVersion = makeExternalStore(0);

export const usePlaylistsVersion = (): number =>
  useSyncExternalStore(playlistsVersion.subscribe, playlistsVersion.get);

/** Calls [listener] after every playlist edit; returns how to stop. */
export const onPlaylistsEdited = (listener: () => void): (() => void) =>
  playlistsVersion.subscribe(listener);

/**
 * The playlists changed (an edit here, or the Wave account sent some):
 * playlist queries re-run, and the remembered list is read again now, so the
 * next card that lists them doesn't wait for it. [playlistIds]: the playlists
 * changed, when known; queries over other playlists stay as they are.
 * [burst]: one of a stream of additions (an import filling a playlist), which
 * screens take at their own pace (Core's `LibraryChange.burst`); the list
 * isn't read ahead for each.
 */
export const playlistsChanged = (playlistIds?: readonly number[], burst = false): void => {
  playlistsVersion.update((version) => version + 1);
  publishLibraryChange({
    kind: "playlists",
    ...(playlistIds === undefined ? {} : { ids: playlistIds }),
    ...(burst ? { burst } : {}),
  });
  if (!burst) appRuntime.runPromise(listPlaylistsRemembered).catch(() => {});
  // A deleted playlist's image goes with it.
  tidyDeletedPlaylistImages();
};

/**
 * Runs a playlist edit, then announces it (for [playlistId] alone, when it
 * edits one playlist; as a burst with [burst]).
 */
const edit = <A>(
  run: (store: LibraryStore["Service"]) => Effect.Effect<A, LibraryStoreError>,
  playlistId?: number,
  burst = false,
): Promise<A> => {
  // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
  const edited = LibraryStore.use(run);
  return appRuntime
    .runPromise(edited)
    .finally(() => playlistsChanged(playlistId === undefined ? undefined : [playlistId], burst));
};

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
 * Add to Playlist card of the session opens at once too, and deletes images
 * a deletion left behind (Wave closed before it got to them). Safe to call
 * repeatedly.
 */
export const primePlaylists = (): void => {
  tidyDeletedPlaylistImages();
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
  hasImage: false,
});

export const renamePlaylist = (id: number, name: string): Promise<void> =>
  edit((store) => store.renamePlaylist(id, name), id);

export const deletePlaylist = (id: number): Promise<void> =>
  edit((store) => store.deletePlaylist(id), id);

/** Deletes playlist image files nothing shows any more; one that won't go is left behind. */
const deleteImageFiles = (paths: readonly string[]): Promise<void> =>
  paths.length === 0 ? Promise.resolve() : WaveNative.deletePlaylistImages(paths).catch(() => {});

/**
 * Opens Android's photo picker and gives the playlist the picked photo,
 * cropped square, as its image in place of its mosaic. The image stays on
 * this phone. Resolves false when nothing was picked.
 */
export const pickPlaylistImage = async (id: number): Promise<boolean> => {
  const files = await WaveNative.pickPlaylistImage();
  if (files === null) return false;
  const unused = await edit((store) => store.setPlaylistImage(id, files), id).catch(
    async (error: unknown) => {
      await deleteImageFiles([files.path, files.thumbPath]);
      throw error;
    },
  );
  await deleteImageFiles(unused);
  return true;
};

/** Takes the playlist's image away, so its mosaic shows again. */
export const removePlaylistImage = (id: number): Promise<void> =>
  edit((store) => store.removePlaylistImage(id), id).then(deleteImageFiles);

/**
 * Deletes the image files of playlists deleted here or, through the Wave
 * account, on another phone. Runs after every playlist change and at app start.
 */
const tidyDeletedPlaylistImages = (): void => {
  appRuntime
    // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
    .runPromise(LibraryStore.use((store) => store.takeDeletedPlaylistImages))
    .then(deleteImageFiles)
    .catch(() => {});
};

/** Appends [songs] the playlist doesn't hold yet (Core's `planPlaylistSongs`). */
export const addToPlaylist = (
  id: number,
  songs: readonly PlaylistSong[],
  /** One of a stream of additions (an import filling the playlist): see `playlistsChanged`. */
  { burst = false }: { readonly burst?: boolean } = {},
): Promise<PlaylistAddResult> => edit((store) => store.addToPlaylist(id, songs), id, burst);

export const movePlaylistItem = (
  playlistId: number,
  itemId: number,
  toIndex: number,
): Promise<void> =>
  edit((store) => store.movePlaylistItem(playlistId, itemId, toIndex), playlistId);

/** Makes the playlist hold exactly these songs, in this order (an import's Replace). */
export const replacePlaylistSongs = (
  playlistId: number,
  songs: readonly PlaylistSong[],
): Promise<void> => edit((store) => store.replacePlaylistSongs(playlistId, songs), playlistId);

/** Removes these entries (not every copy of their songs) from the playlist. */
export const removePlaylistItems = (
  playlistId: number,
  itemIds: readonly number[],
): Promise<void> => edit((store) => store.removePlaylistItems(playlistId, itemIds), playlistId);
