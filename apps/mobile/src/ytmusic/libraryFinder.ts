import { libraryFinder, type YtSong } from "@wave/core";
import * as Effect from "effect/Effect";
import { useMemo, useSyncExternalStore } from "react";

import { libraryVersion } from "@/library/LibraryScan";
import { LibraryStore, type SongRow } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";
import { makeVersionedCache } from "@/lib/versionedCache";

/** The Library song a YT Music song already is (Core's `libraryFinder`), or null. */
export type FindInLibrary = (song: YtSong) => SongRow | null;

const nothing: FindInLibrary = () => null;

const listSongs = Effect.gen(function* () {
  const store = yield* LibraryStore;
  return yield* store.listSongs;
});

/**
 * One finder for every screen: the Library is read and the finder built once
 * per `libraryVersion` (a download lands, a scan goes on), and only while a
 * screen uses it. Null until the Library is first read.
 */
const sharedFinder = makeVersionedCache<FindInLibrary | null>({
  version: libraryVersion,
  initial: null,
  build: () => appRuntime.runPromise(listSongs).then((songs) => libraryFinder(songs)),
});

const idle = () => () => {};

/**
 * The shared finder, or null until the Library is first read. It follows the
 * Library only while [active]; inactive, it reads what was last built.
 */
export const useLoadedLibraryFinder = (active = true): FindInLibrary | null =>
  useSyncExternalStore(active ? sharedFinder.subscribe : idle, sharedFinder.get);

/**
 * Finds the Library song a YT Music song already is, so a YT Music list plays the
 * file instead of streaming it and a song's menu knows whether it's still in
 * the Library. Finds nothing until the Library is first read.
 */
export const useLibraryFinder = (): FindInLibrary => useLoadedLibraryFinder() ?? nothing;

/** Whether the Library already has a YT Music song. */
export type InLibrary = (song: YtSong) => boolean;

const everything: InLibrary = () => true;

/**
 * Whether the Library already has a YT Music song (the shared finder), every
 * song taken as in the Library until the Library has been read, so Download
 * never shows only to go away.
 */
export const useLoadedInLibrary = (): InLibrary => {
  const find = useLoadedLibraryFinder();
  return useMemo(() => (find === null ? everything : (song) => find(song) !== null), [find]);
};
