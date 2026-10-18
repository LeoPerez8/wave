import {
  libraryLyrics,
  libraryLyricsSong,
  parseTrackId,
  type FoundLyrics,
  type LyricsAnswer,
  type Lyrics,
} from "@wave/core";
import * as Effect from "effect/Effect";
import { useCallback, useEffect, useState } from "react";

import type { LyricsSearchTrack } from "@/library/db/lyricsMisses";
import { LibraryStore } from "@/library/LibraryStore";
import { writeFoundLyrics } from "@/library/lyricsAndGenre";
import { appRuntime } from "@/library/runtime";
import { useLyricsAndGenreLookupsEnabled } from "@/settings/lyricsAndGenre";
import { useYtMusicEnabled } from "@/settings/ytMusic";

import { useLyrics } from "./useLyrics";
import { askLyrics } from "./useNonDLyrics";

/**
 * What the Lyrics view shows for a Library song: its file's lyrics (or
 * today's "No lyrics"), lyrics found online, the skeleton while it searches,
 * or Try again when it couldn't.
 */
export type LibraryLyricsShown =
  Lyrics | { readonly kind: "searching" } | { readonly kind: "failed" };

const NO_LYRICS: Lyrics = { kind: "none" };
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
    .catch((cause: unknown) => console.warn("[wave] couldn't write the lyrics found", cause));

/**
 * What the Lyrics view shows for the Library track [trackId] at [path], and
 * Try again (docs/spec.md, "Lyrics online"). Lyrics in its file or a sidecar
 * show and nothing is asked. A file without lyrics is searched online as a
 * non-D song is (Core's `libraryLyrics`): the skeleton while LRCLIB, then YT
 * Music for a song downloaded from a video, are asked; a hit is written into
 * the file and shows, and a miss shows today's "No lyrics" and is remembered
 * for a week. Nothing is asked while Fix songs online is off. Null while the
 * file is read, or for a track that isn't the Library's.
 */
export const useLibraryLyrics = (
  trackId: string | null,
  path: string | null,
): { readonly shown: LibraryLyricsShown | null; readonly retry: () => void } => {
  const file = useLyrics(path);
  const lookupsOn = useLyricsAndGenreLookupsEnabled();
  const ytMusicOn = useYtMusicEnabled();
  const track = trackId === null ? null : parseTrackId(trackId);
  const libraryId = track?.kind === "library" ? track.id : null;
  // Only whether the file has none matters: reading it again finding none still doesn't search twice.
  const fileHasNone = file?.kind === "none";
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    readonly path: string;
    readonly attempt: number;
    readonly shown: LibraryLyricsShown;
  } | null>(null);

  useEffect(() => {
    if (libraryId === null || path === null || !fileHasNone) return undefined;
    let current = true;
    const show = (shown: LibraryLyricsShown): void => {
      if (current) setState({ path, attempt, shown });
    };
    void (async () => {
      const searchTrack = await readSearchTrack(libraryId);
      if (searchTrack === null) {
        show(NO_LYRICS);
        return;
      }
      const song = libraryLyricsSong(searchTrack);
      const answers: LyricsAnswer[] = [];
      for (;;) {
        const step = libraryLyrics(song, {
          file: NO_LYRICS,
          missedAt: searchTrack.missedAt,
          answers,
          lookupsOn,
          ytMusicOn,
          now: Date.now(),
        });
        switch (step.kind) {
          case "searching":
            break;
          case "lyrics":
            show(step.lyrics);
            if (step.write !== null) await writeIntoFile(libraryId, path, step.write);
            return;
          case "none":
            if (step.remember !== null) await keepMiss(libraryId, step.remember);
            show(NO_LYRICS);
            return;
          case "failed":
            show(FAILED);
            return;
        }
        show(SEARCHING);
        // Gone from the view (another song, closed): no more requests.
        if (!current) return;
        answers.push(await askLyrics(step.ask, song));
      }
    })();
    return () => {
      current = false;
    };
  }, [libraryId, path, fileHasNone, lookupsOn, ytMusicOn, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  if (file === null || path === null) return { shown: null, retry };
  if (file.kind !== "none" || libraryId === null) return { shown: file, retry };
  if (state?.path !== path) return { shown: null, retry };
  // Try again shows the skeleton at once, not the failure it's retrying.
  return { shown: state.attempt === attempt ? state.shown : SEARCHING, retry };
};
