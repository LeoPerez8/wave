import * as Effect from "effect/Effect";
import { useSyncExternalStore } from "react";

import { makeExternalStore } from "@/lib/externalStore";

import { LibraryStore, type LibraryStoreError, type PlaylistAddResult } from "./LibraryStore";
import { appRuntime } from "./runtime";

/** Bumped after every playlist edit; playlist queries re-run on it straight away. */
const playlistsVersion = makeExternalStore(0);

export const usePlaylistsVersion = (): number =>
  useSyncExternalStore(playlistsVersion.subscribe, playlistsVersion.get);

const edit = <A>(
  run: (store: LibraryStore["Service"]) => Effect.Effect<A, LibraryStoreError>,
): Promise<A> =>
  appRuntime
    .runPromise(LibraryStore.use(run))
    .finally(() => playlistsVersion.update((version) => version + 1));

/** Every playlist's name, for checking a new name with Core's `checkPlaylistName`. */
export const playlistNames = (): Promise<readonly string[]> =>
  appRuntime
    .runPromise(LibraryStore.use((store) => store.listPlaylists))
    .then((playlists) => playlists.map((playlist) => playlist.name));

export const createPlaylist = (
  name: string,
  trackIds: readonly number[] = [],
): Promise<PlaylistAddResult> => edit((store) => store.createPlaylist(name, trackIds));

export const renamePlaylist = (id: number, name: string): Promise<void> =>
  edit((store) => store.renamePlaylist(id, name));

export const deletePlaylist = (id: number): Promise<void> =>
  edit((store) => store.deletePlaylist(id));

export const addToPlaylist = (
  id: number,
  trackIds: readonly number[],
): Promise<PlaylistAddResult> => edit((store) => store.addToPlaylist(id, trackIds));

export const movePlaylistItem = (
  playlistId: number,
  itemId: number,
  toIndex: number,
): Promise<void> => edit((store) => store.movePlaylistItem(playlistId, itemId, toIndex));

export const removePlaylistItem = (playlistId: number, itemId: number): Promise<void> =>
  edit((store) => store.removePlaylistItem(playlistId, itemId));
