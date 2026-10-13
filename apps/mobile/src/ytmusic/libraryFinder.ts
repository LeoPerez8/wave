import { libraryFinder, type YtSong } from "@wave/core";
import * as Effect from "effect/Effect";
import { useEffect, useState } from "react";

import { libraryVersion } from "@/library/LibraryScan";
import { LibraryStore, type SongRow } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";

/** The Library song a YT Music song already is (Core's `libraryFinder`), or null. */
export type FindInLibrary = (song: YtSong) => SongRow | null;

const nothing: FindInLibrary = () => null;

const listSongs = Effect.gen(function* () {
  const store = yield* LibraryStore;
  return yield* store.listSongs;
});

/**
 * Finds the Library song a YT Music song already is, so Discover plays the
 * file instead of streaming it. Finds nothing until the Library is read, and
 * reads it again whenever it changes (a download lands, a scan goes on), one
 * read at a time.
 */
export const useLibraryFinder = (): FindInLibrary => {
  const [find, setFind] = useState<FindInLibrary>(() => nothing);

  useEffect(() => {
    let mounted = true;
    let reading = false;
    let stale = false;
    const read = (): void => {
      if (reading) {
        stale = true;
        return;
      }
      reading = true;
      appRuntime
        .runPromise(listSongs)
        .then((songs) => {
          if (mounted) setFind(() => libraryFinder(songs));
        })
        .catch(() => {
          // Keep the last finder; store errors surface elsewhere (scan banner).
        })
        .finally(() => {
          reading = false;
          if (stale && mounted) {
            stale = false;
            read();
          }
        });
    };
    read();
    const unsubscribe = libraryVersion.subscribe(read);
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  return find;
};
