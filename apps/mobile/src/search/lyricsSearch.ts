import { findLyricMatch } from "@wave/core";
import * as Effect from "effect/Effect";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import type { SongRow } from "@/library/LibraryStore";
import { LibraryStore } from "@/library/LibraryStore";
import { lyricsSearchIndexVersion } from "@/library/lyricsSearchIndex";
import { appRuntime } from "@/library/runtime";

export interface LocalLyricsHit {
  readonly source: "library";
  readonly song: SongRow;
  readonly line: string;
  readonly ranges: readonly { readonly start: number; readonly end: number }[];
}

const EMPTY: readonly LocalLyricsHit[] = [];

/** Reads indexed candidates, then lets Core choose each hit's line and ranges. */
export const useLocalLyricsSearch = (
  query: string,
  songs: readonly SongRow[],
  skipIds: ReadonlySet<number>,
): readonly LocalLyricsHit[] => {
  const version = useSyncExternalStore(
    lyricsSearchIndexVersion.subscribe,
    lyricsSearchIndexVersion.get,
  );
  const songsById = useMemo(() => new Map(songs.map((song) => [song.id, song])), [songs]);
  const [answer, setAnswer] = useState<{
    query: string;
    version: number;
    hits: readonly LocalLyricsHit[];
  }>({ query: "", version: -1, hits: EMPTY });

  useEffect(() => {
    const normalized = query.trim();
    if (normalized === "") return undefined;
    let cancelled = false;
    void appRuntime
      .runPromise(
        Effect.gen(function* () {
          const store = yield* LibraryStore;
          return yield* store.searchLyrics(normalized);
        }),
      )
      .then((candidates) => {
        if (cancelled) return;
        const hits: LocalLyricsHit[] = [];
        for (const candidate of candidates) {
          if (skipIds.has(candidate.trackId)) continue;
          const song = songsById.get(candidate.trackId);
          if (song === undefined) continue;
          const match = findLyricMatch(candidate.lyrics, normalized);
          if (match !== null) hits.push({ source: "library", song, ...match });
        }
        setAnswer({ query, version, hits });
      })
      .catch(() => {
        if (!cancelled) setAnswer({ query, version, hits: EMPTY });
      });
    return () => {
      cancelled = true;
    };
  }, [query, version, songsById, skipIds]);

  return query.trim() !== "" && answer.query === query && answer.version === version
    ? answer.hits
    : EMPTY;
};
