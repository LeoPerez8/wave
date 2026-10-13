/**
 * Find Lyrics and Genre as the owner starts it: on songs from a menu or the
 * selection bar, or on the whole Library from Settings, in the background
 * with progress and Cancel. Each ends with Core's summary (`describeTagLookups`).
 */
import { describeTagLookups, type SongTagOutcome, type TagLookupStop } from "@wave/core";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { useSyncExternalStore } from "react";

import { makeExternalStore } from "@/lib/externalStore";
import { showError, showMessage } from "@/overlay/alert";

import { LibraryStore } from "./LibraryStore";
import { findLyricsAndGenreForSongs, LookupsOff, type TaggableSong } from "./lyricsAndGenre";
import { appRuntime } from "./runtime";

type Result = { readonly title: string; readonly outcome: SongTagOutcome };

/** Runs [songs] through the lookup, collecting results; resolves how the run ended. */
const run = async (
  songs: readonly TaggableSong[],
  results: Result[],
  onResult: () => void,
  signal?: AbortSignal,
): Promise<{ readonly stop: TagLookupStop | undefined; readonly error: unknown }> => {
  const exit = await appRuntime.runPromiseExit(
    findLyricsAndGenreForSongs(songs, (song, outcome) => {
      results.push({ title: song.title, outcome });
      onResult();
    }),
    signal === undefined ? undefined : { signal },
  );
  const left = songs.length - results.length;
  if (Exit.isSuccess(exit))
    return {
      stop: exit.value === "unreachable" ? { stopped: "unreachable", left } : undefined,
      error: undefined,
    };
  const error = Cause.squash(exit.cause);
  // Cancel, or Settings turning lookups off halfway: the songs left aren't looked up.
  if (Cause.hasInterruptsOnly(exit.cause) || error instanceof LookupsOff)
    return { stop: { stopped: "cancelled", left }, error: undefined };
  return { stop: undefined, error };
};

const report = async (
  results: readonly Result[],
  outcome: { readonly stop: TagLookupStop | undefined; readonly error: unknown },
): Promise<void> => {
  if (outcome.error !== undefined && results.length === 0) {
    await showError("Couldn't find lyrics and genre", outcome.error);
    return;
  }
  const { title, message } = describeTagLookups(results, outcome.stop);
  await showMessage(title, message);
};

/**
 * Find Lyrics and Genre on songs from a long-press menu or the selection bar:
 * looks them up one after another in the background, writes what is found
 * and says how it went.
 */
export const findLyricsAndGenreFor = async (songs: readonly TaggableSong[]): Promise<void> => {
  if (songs.length === 0) return;
  const results: Result[] = [];
  await report(results, await run(songs, results, () => {}));
};

/** The Library-wide run, for Settings: its progress while it runs. */
export type LibraryLookupState =
  | { readonly status: "idle" }
  | { readonly status: "running"; readonly done: number; readonly total: number };

const libraryLookup = makeExternalStore<LibraryLookupState>({ status: "idle" });
let libraryRun: AbortController | null = null;

/** The Library-wide run's progress; re-renders as songs are done. */
export const useLibraryLookup = (): LibraryLookupState =>
  useSyncExternalStore(libraryLookup.subscribe, libraryLookup.get);

/**
 * Finds lyrics and genre for every song in the Library, in the background,
 * with progress (`useLibraryLookup`); `cancelLibraryLookup` stops it. Ends with
 * the updated / not found / failed summary. Does nothing while one runs.
 */
export const startLibraryLookup = async (): Promise<void> => {
  if (libraryRun !== null) return;
  const controller = new AbortController();
  libraryRun = controller;
  libraryLookup.set({ status: "running", done: 0, total: 0 });
  try {
    const songs = await appRuntime.runPromise(
      Effect.gen(function* () {
        return yield* (yield* LibraryStore).listSongs;
      }),
    );
    const results: Result[] = [];
    libraryLookup.set({ status: "running", done: 0, total: songs.length });
    const outcome = controller.signal.aborted
      ? { stop: { stopped: "cancelled", left: songs.length } as const, error: undefined }
      : await run(
          songs,
          results,
          () => libraryLookup.set({ status: "running", done: results.length, total: songs.length }),
          controller.signal,
        );
    libraryLookup.set({ status: "idle" });
    libraryRun = null;
    await report(results, outcome);
  } catch (error) {
    libraryLookup.set({ status: "idle" });
    libraryRun = null;
    await showError("Couldn't find lyrics and genre", error);
  }
};

/** Stops the Library-wide run; songs done so far keep what was written. */
export const cancelLibraryLookup = (): void => {
  libraryRun?.abort();
};
