import { findLyricMatch } from "@wave/core";
import * as Effect from "effect/Effect";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import type { SongRow } from "@/library/LibraryStore";
import { LibraryStore } from "@/library/LibraryStore";
import { lyricsSearchIndexVersion } from "@/library/lyricsSearchVersion";
import { appRuntime } from "@/library/runtime";
import type { NativeYtSong } from "@/native/waveYtMusic";

export type LocalLyricsHit =
  | {
      readonly source: "library";
      readonly song: SongRow;
      readonly line: string;
      readonly ranges: readonly { readonly start: number; readonly end: number }[];
    }
  | {
      readonly source: "stream";
      readonly song: NativeYtSong;
      readonly line: string;
      readonly ranges: readonly { readonly start: number; readonly end: number }[];
    };

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
  // The last answer, kept for its query while the index is read again (the background fill
  // bumps its version every few hundred ms), so the section doesn't blink out and back.
  const [answer, setAnswer] = useState<{
    query: string;
    hits: readonly LocalLyricsHit[];
  }>({ query: "", hits: EMPTY });

  useEffect(() => {
    const normalized = query.trim();
    if (normalized === "") return undefined;
    let cancelled = false;
    void appRuntime
      .runPromise(
        Effect.gen(function* () {
          const store = yield* LibraryStore;
          const candidates = yield* store.searchLyrics(normalized);
          const saved = yield* store.searchSavedLyrics(normalized);
          const streamed = yield* store.streamedSongsByIds(
            saved.map((candidate) => candidate.videoId),
          );
          const libraryCopies = yield* store.songsWithVideos(
            saved.map((candidate) => candidate.videoId),
          );
          const hits: LocalLyricsHit[] = [];
          for (const candidate of candidates) {
            if (skipIds.has(candidate.trackId)) continue;
            const song = songsById.get(candidate.trackId);
            if (song === undefined) continue;
            const match = findLyricMatch(candidate.lyrics, normalized);
            if (match !== null) hits.push({ source: "library", song, ...match });
          }
          for (const candidate of saved) {
            const song = streamed.get(candidate.videoId);
            if (song === undefined || libraryCopies.has(candidate.videoId)) continue;
            const match = findLyricMatch(candidate.lyrics, normalized);
            if (match !== null) hits.push({ source: "stream", song, ...match });
          }
          return hits;
        }),
      )
      .then((candidates) => {
        if (cancelled) return;
        setAnswer({ query, hits: candidates });
      })
      .catch(() => {
        if (!cancelled) setAnswer({ query, hits: EMPTY });
      });
    return () => {
      cancelled = true;
    };
    // A new index version re-reads the candidates.
  }, [query, version, songsById, skipIds]);

  return query.trim() !== "" && answer.query === query ? answer.hits : EMPTY;
};
