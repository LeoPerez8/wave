import { findLyricMatch } from "@wave/core";
import * as Effect from "effect/Effect";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import type { SongRow } from "@wave/client";
import { LibraryStore } from "@/library/LibraryStore";

import { lyricsSearchIndexVersion } from "@/library/lyricsSearchVersion";
import { appRuntime } from "@/library/runtime";
import type { NativeYtSong } from "@/native/waveYtMusic";

import { lyricsQueries } from "./lyricsQueries";

type Ranges = readonly { readonly start: number; readonly end: number }[];

export type LocalLyricsHit =
  | {
      readonly source: "library";
      readonly song: SongRow;
      readonly line: string;
      readonly ranges: Ranges;
    }
  | {
      readonly source: "stream";
      readonly song: NativeYtSong;
      readonly line: string;
      readonly ranges: Ranges;
    };

/** One read's matches, before they meet the Library's rows and what Songs already shows. */
type LyricsAnswer = {
  readonly library: readonly { readonly trackId: number; readonly line: string; readonly ranges: Ranges }[];
  readonly stream: readonly Extract<LocalLyricsHit, { source: "stream" }>[];
};

const EMPTY: readonly LocalLyricsHit[] = [];
const NO_ANSWER: LyricsAnswer = { library: [], stream: [] };

/** Reads the word index for [query] and lets Core choose each hit's line and ranges. */
const readLyrics = (query: string): Promise<LyricsAnswer> =>
  appRuntime.runPromise(
    Effect.gen(function* () {
      const store = yield* LibraryStore;
      const candidates = yield* store.searchLyrics(query);
      const saved = yield* store.searchSavedLyrics(query);
      const streamed = yield* store.streamedSongsByIds(saved.map((candidate) => candidate.videoId));
      const libraryCopies = yield* store.songsWithVideos(
        saved.map((candidate) => candidate.videoId),
      );
      const library: LyricsAnswer["library"][number][] = [];
      for (const candidate of candidates) {
        const match = findLyricMatch(candidate.lyrics, query);
        if (match !== null) library.push({ trackId: candidate.trackId, ...match });
      }
      const stream: LyricsAnswer["stream"][number][] = [];
      for (const candidate of saved) {
        const song = streamed.get(candidate.videoId);
        if (song === undefined || libraryCopies.has(candidate.videoId)) continue;
        const match = findLyricMatch(candidate.lyrics, query);
        if (match !== null) stream.push({ source: "stream", song, ...match });
      }
      return { library, stream };
    }),
  );

/**
 * Lyrics' results for [query]. The word index is read once typing pauses, or at once on
 * [submit] (#1354): a keystroke reads nothing. Until the new query's answer arrives the last
 * one stays, so the section keeps its place instead of blinking out and back in.
 */
export const useLocalLyricsSearch = (
  query: string,
  songs: readonly SongRow[],
  skipIds: ReadonlySet<number>,
): { readonly hits: readonly LocalLyricsHit[]; readonly submit: (query: string) => void } => {
  const version = useSyncExternalStore(
    lyricsSearchIndexVersion.subscribe,
    lyricsSearchIndexVersion.get,
  );
  const [answer, setAnswer] = useState<LyricsAnswer>(NO_ANSWER);
  const [queries] = useState(() =>
    lyricsQueries<LyricsAnswer>({
      read: readLyrics,
      answer: (_query, next) => setAnswer(next),
      fail: () => setAnswer(NO_ANSWER),
      clear: () => setAnswer(NO_ANSWER),
    }),
  );
  useEffect(() => () => queries.dispose(), [queries]);

  const empty = query.trim() === "";
  useEffect(() => queries.type(query), [queries, query]);
  // The background fill bumps the index's version every few hundred ms: the settled query is
  // read again, and its last answer stays meanwhile.
  const seenVersion = useRef(version);
  useEffect(() => {
    if (seenVersion.current === version) return;
    seenVersion.current = version;
    queries.refresh();
  }, [queries, version]);

  const songsById = useMemo(() => new Map(songs.map((song) => [song.id, song])), [songs]);
  const hits = useMemo((): readonly LocalLyricsHit[] => {
    if (answer.library.length === 0 && answer.stream.length === 0) return EMPTY;
    const found: LocalLyricsHit[] = [];
    for (const hit of answer.library) {
      if (skipIds.has(hit.trackId)) continue;
      const song = songsById.get(hit.trackId);
      if (song !== undefined) found.push({ source: "library", song, line: hit.line, ranges: hit.ranges });
    }
    found.push(...answer.stream);
    return found;
  }, [answer, songsById, skipIds]);

  return { hits: empty ? EMPTY : hits, submit: queries.submit };
};
