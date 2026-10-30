import {
  libraryFinder,
  libraryFinderSteps,
  playlistInLibrarySteps,
  type PlaylistItem,
  type YtSong,
} from "@wave/core";
import { useEffect, useMemo, useState } from "react";

import { freeTurnEffect } from "@/lib/backgroundWork";
import { runSteps } from "@/lib/stepped";
import { libraryListQueries } from "@/library/hooks";
import { libraryVersion } from "@/library/LibraryScan";
import type { SongRow } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";
import { useLibraryQuery } from "@/library/sharedQueries";

import { makeFinderCache } from "./finderCache";

/** The Library song a YT Music song already is (Core's `libraryFinder`), or null. */
export type FindInLibrary = (song: YtSong) => SongRow | null;

const nothing: FindInLibrary = () => null;

/** How to build a finder between frames, before its first use would build it all at once. */
const preparations = new WeakMap<FindInLibrary, () => Generator<void, void>>();

/** Core's `libraryFinder` over [songs], built on its first use: a list may never ask. */
const finderOver = (songs: readonly SongRow[]): FindInLibrary => {
  let built: FindInLibrary | null = null;
  const find: FindInLibrary = (song) => (built ??= libraryFinder(songs))(song);
  preparations.set(find, function* () {
    if (built !== null) return;
    const stepped = yield* libraryFinderSteps(songs);
    built ??= stepped;
  });
  return find;
};

const songsQuery = libraryListQueries.songs;

/**
 * One finder for every screen, over the songs the Library's shared `songs`
 * query read (the Songs tab's and Search's read): one read and one finder for
 * all of them, re-read as that query is.
 */
const finders = makeFinderCache<SongRow, FindInLibrary>({
  version: libraryVersion.get,
  read: () => appRuntime.runPromise(songsQuery.read),
  build: finderOver,
});

/** Reuses the shared cache for an already-read subset without another Library read. */
export const libraryFinderForRows = (songs: readonly SongRow[]): FindInLibrary =>
  finders.forRows(songs);

/** A finder current with the Library: at once when one was read at this Library version, else after a read. */
export const currentLibraryFinder = (): Promise<FindInLibrary> => finders.current();

/** The last finder built, unfollowed, or null before the Library was first read: for a row's render. */
export const knownLibraryFinder = (): FindInLibrary | null => finders.known();

/**
 * The shared finder, or null until the Library is first read. It follows the
 * Library (the shared `songs` query) only while [active]; inactive, or until
 * its read lands, it is the last one built.
 */
export const useLoadedLibraryFinder = (active = true): FindInLibrary | null => {
  const songs = useLibraryQuery(active ? songsQuery : null, null);
  return songs === null ? finders.known() : finders.over(songs);
};

/**
 * Finds the Library song a YT Music song already is, so a YT Music list plays the
 * file instead of streaming it and a song's menu knows whether it's still in
 * the Library. Finds nothing until the Library is first read. Follows the
 * Library only while [active] (`useLoadedLibraryFinder`).
 */
export const useLibraryFinder = (active = true): FindInLibrary =>
  useLoadedLibraryFinder(active) ?? nothing;

/** Whether the Library already has a YT Music song. */
export type InLibrary = (song: YtSong) => boolean;

const everything: InLibrary = () => true;

/**
 * Whether the Library already has a YT Music song (the shared finder), every
 * song taken as in the Library until the Library has been read, so Download
 * never shows only to go away.
 */
export const useLoadedInLibrary = (active = true): InLibrary => {
  const find = useLoadedLibraryFinder(active);
  return useMemo(() => (find === null ? everything : (song) => find(song) !== null), [find]);
};

/** Whether the Library has a song, once it's been worked out for a whole list. */
export interface InLibraryAnswer {
  readonly inLibrary: InLibrary;
  /** False until it's worked out: every song counts as the Library's, as before its first read. */
  readonly loaded: boolean;
}

const NOT_YET: InLibraryAnswer = { inLibrary: everything, loaded: false };

/** A list this short asks in its render, as ever: its button is there on its first frame. */
const ASKED_AT_ONCE = 500;

/**
 * `useLoadedInLibrary` for a list that may be long ([entries]): past a few hundred
 * songs it works out which the Library has between frames, so opening the list
 * doesn't search the Library for each of them in one render (#842). The last
 * answer stands while a new one is worked out.
 */
export const useInLibraryBetweenFrames = (
  entries: readonly PlaylistItem<YtSong, unknown>[],
): InLibraryAnswer => {
  const find = useLoadedLibraryFinder();
  const atOnce = entries.length <= ASKED_AT_ONCE;
  const direct = useMemo(
    (): InLibraryAnswer | null =>
      find === null
        ? NOT_YET
        : atOnce
          ? { inLibrary: (song) => find(song) !== null, loaded: true }
          : null,
    [find, atOnce],
  );
  const [answer, setAnswer] = useState<InLibraryAnswer | null>(null);
  useEffect(() => {
    if (find === null || atOnce) return;
    const working = new AbortController();
    const steps = function* (): Generator<void, InLibrary> {
      yield* preparations.get(find)?.() ?? [];
      return yield* playlistInLibrarySteps(entries, (song) => find(song) !== null);
    };
    appRuntime
      .runPromise(runSteps(steps(), freeTurnEffect), { signal: working.signal })
      .then((inLibrary) => setAnswer({ inLibrary, loaded: true }))
      .catch(() => {});
    return () => working.abort();
  }, [entries, find, atOnce]);
  if (direct !== null) return direct;
  return answer ?? NOT_YET;
};
