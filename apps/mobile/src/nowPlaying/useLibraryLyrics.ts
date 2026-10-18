import { libraryLyrics, libraryLyricsSong, type FoundLyrics, type Lyrics } from "@wave/core";
import * as Effect from "effect/Effect";
import { useMemo } from "react";

import type { LyricsSearchTrack } from "@/library/db/lyricsMisses";
import { LibraryStore } from "@/library/LibraryStore";
import { TagWriteFailed, writeFoundLyrics } from "@/library/lyricsAndGenre";
import { appRuntime } from "@/library/runtime";
import { useLyricsAndGenreLookupsEnabled } from "@/settings/lyricsAndGenre";
import { useYtMusicEnabled } from "@/settings/ytMusic";

import { useLyrics } from "./useLyrics";
import { useLyricsSearch, type LyricsSearchPlan } from "./useLyricsSearch";

/**
 * What the Lyrics view shows for a Library song: its file's lyrics (or
 * today's "No lyrics"), lyrics found online, the skeleton while it searches,
 * or Try again when it couldn't.
 */
export type LibraryLyricsShown =
  Lyrics | { readonly kind: "searching" } | { readonly kind: "failed" };

const NO_LYRICS: LibraryLyricsShown = { kind: "none" };
const SEARCHING: LibraryLyricsShown = { kind: "searching" };
const FAILED: LibraryLyricsShown = { kind: "failed" };

/** What the search for [trackId] goes by; null when it can't be read. */
const readSearchTrack = (trackId: number): Promise<LyricsSearchTrack | null> =>
  appRuntime
    .runPromise(
      Effect.gen(function* () {
        const store = yield* LibraryStore;
        return yield* store.lyricsSearchTrack(trackId);
      }),
    )
    .catch(() => null);

/** Remembers when the search for [trackId] found nothing (null forgets it). */
const keepMiss = (trackId: number, checkedAt: number | null): Promise<void> =>
  appRuntime
    .runPromise(
      Effect.gen(function* () {
        const store = yield* LibraryStore;
        yield* store.keepLyricsMiss(trackId, checkedAt);
      }),
    )
    .catch((cause: unknown) => console.warn("[wave] couldn't remember the lyrics search", cause));

/**
 * Writes [found] into the file at [path], as Fix Song does; an open Lyrics
 * view then reads them from it. A file that can't be written keeps nothing:
 * the lyrics still show this time.
 */
const writeIntoFile = (trackId: number, path: string, found: FoundLyrics): Promise<void> =>
  appRuntime
    .runPromise(writeFoundLyrics(path, found))
    .then(() => keepMiss(trackId, null))
    .catch((cause: unknown) => {
      // A failed write is logged with why where it failed.
      if (!(cause instanceof TagWriteFailed))
        console.warn("[wave] couldn't write the lyrics found", cause);
    });

/**
 * What the Lyrics view shows for the Library track [libraryId] whose file is
 * at [path], and Try again (docs/spec.md, "Lyrics online"). Lyrics in its
 * file or a sidecar show and nothing is asked. A file without lyrics is
 * searched online as a non-D song is (Core's `libraryLyrics`): the skeleton
 * while LRCLIB, then YT Music for a song downloaded from a video, are asked;
 * a hit is written into the file and shows, and a miss shows today's "No
 * lyrics" and is remembered for a week. Nothing is asked while Fix songs
 * online is off. Null while the file is read, or with no file.
 */
export const useLibraryLyrics = (
  libraryId: number | null,
  path: string | null,
): { readonly shown: LibraryLyricsShown | null; readonly retry: () => void } => {
  const file = useLyrics(path);
  const lookupsOn = useLyricsAndGenreLookupsEnabled();
  const ytMusicOn = useYtMusicEnabled();
  // Only whether the file has none matters: reading it again finding none still doesn't search twice.
  const fileHasNone = file?.kind === "none";

  const begin = useMemo(() => {
    if (!fileHasNone || libraryId === null || path === null) return null;
    return async (): Promise<
      LyricsSearchPlan<LibraryLyricsShown> | { shown: LibraryLyricsShown }
    > => {
      const searchTrack = await readSearchTrack(libraryId);
      if (searchTrack === null) return { shown: NO_LYRICS };
      const song = libraryLyricsSong(searchTrack);
      return {
        song,
        step: (answers) => {
          const step = libraryLyrics(song, {
            missedAt: searchTrack.missedAt,
            answers,
            lookupsOn,
            ytMusicOn,
            now: Date.now(),
          });
          switch (step.kind) {
            case "searching":
              return { kind: "ask", source: step.ask };
            case "lyrics":
              return {
                kind: "done",
                shown: step.lyrics,
                keep: () => writeIntoFile(libraryId, path, step.write),
              };
            case "none": {
              const { remember } = step;
              return {
                kind: "done",
                shown: NO_LYRICS,
                keep: remember === null ? null : () => keepMiss(libraryId, remember),
              };
            }
            case "failed":
              return { kind: "done", shown: FAILED, keep: null };
          }
        },
      };
    };
  }, [fileHasNone, libraryId, path, lookupsOn, ytMusicOn]);

  const search = useLyricsSearch(begin === null ? null : path, begin, SEARCHING);
  if (file === null || path === null) return { shown: null, retry: search.retry };
  if (begin === null) return { shown: file, retry: search.retry };
  return search;
};
