/**
 * Find Lyrics and Genre as the owner starts it: on songs from a menu or the
 * selection bar, or on the whole Library from Settings, in the background (a
 * foreground service, `WaveLibraryLookup`) with progress and Cancel in
 * Settings and in a notification. Each ends with Core's summary (`describeTagLookups`).
 */
import {
  describeTagLookups,
  libraryLookupProgress,
  readLibraryLookupSummary,
  writeLibraryLookupSummary,
  type LibraryLookupSummary,
  type SongTagOutcome,
  type TagLookupStop,
} from "@wave/core";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { useSyncExternalStore } from "react";
import { AppRegistry, AppState, PermissionsAndroid, Platform } from "react-native";

import { makeExternalStore } from "@/lib/externalStore";
import { persistedSetting } from "@/lib/persistedSetting";
import { LIBRARY_LOOKUP_TASK, WaveLibraryLookup } from "@/native/waveLibraryLookup";
import { showMessage } from "@/overlay/alert";

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

const failedSummary = (error: unknown): LibraryLookupSummary => ({
  title: "Couldn't find lyrics and genre",
  message: error instanceof Error ? error.message : String(error),
});

/**
 * How a run went, as its end message says it: Core's summary, or what went
 * wrong when the run failed before anything was looked up.
 */
const summarize = (
  results: readonly Result[],
  outcome: { readonly stop: TagLookupStop | undefined; readonly error: unknown },
): LibraryLookupSummary =>
  outcome.error !== undefined && results.length === 0
    ? failedSummary(outcome.error)
    : describeTagLookups(results, outcome.stop);

/**
 * Find Lyrics and Genre on songs from a long-press menu or the selection bar:
 * looks them up one after another in the background, writes what is found
 * and says how it went.
 */
export const findLyricsAndGenreFor = async (songs: readonly TaggableSong[]): Promise<void> => {
  if (songs.length === 0) return;
  const results: Result[] = [];
  const { title, message } = summarize(results, await run(songs, results, () => {}));
  await showMessage(title, message);
};

/** The Library-wide run, for Settings: its progress while it runs. */
export type LibraryLookupState =
  | { readonly status: "idle" }
  | { readonly status: "running"; readonly done: number; readonly total: number };

const libraryLookup = makeExternalStore<LibraryLookupState>({ status: "idle" });
let libraryRun: AbortController | null = null;
/** Settles when the current run is over; the `WaveLibraryLookup` headless task waits for it. */
let libraryRunOver: Promise<void> = Promise.resolve();
let endLibraryRun = (): void => {};

/**
 * The run's end summary, kept until the owner has seen it in Wave: a run that
 * ends with Wave in the background (or closed) shows it when Wave is back.
 */
const unseenSummary = persistedSetting<LibraryLookupSummary | null>({
  key: "lyricsAndGenre.unseenLibrarySummary",
  read: readLibraryLookupSummary,
  write: (summary) => (summary === null ? null : writeLibraryLookupSummary(summary)),
});

// Native holds this task while the run goes on, so React Native keeps JS timers running
// with Wave in the background; it ends when the run is over.
AppRegistry.registerHeadlessTask(LIBRARY_LOOKUP_TASK, () => () => libraryRunOver);
// Cancel in the run's notification.
WaveLibraryLookup.addListener("onCancel", () => cancelLibraryLookup());

/** The Library-wide run's progress; re-renders as songs are done. */
export const useLibraryLookup = (): LibraryLookupState =>
  useSyncExternalStore(libraryLookup.subscribe, libraryLookup.get);

/** Shows [done] of [total] in Settings and in the notification. */
const showProgress = (done: number, total: number): void => {
  libraryLookup.set({ status: "running", done, total });
  const { title, detail } = libraryLookupProgress(done, total);
  WaveLibraryLookup.progress(title, detail, done, total);
};

let askedForNotifications = false;
/** Android 13+ hides the run's notification unless Wave may post notifications. */
const askForNotifications = (): void => {
  if (askedForNotifications || Platform.OS !== "android" || Number(Platform.Version) < 33) return;
  askedForNotifications = true;
  void PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS).catch(
    () => undefined,
  );
};

/**
 * Finds lyrics and genre for [songs] (the caller picks them from the Library),
 * showing progress as it goes; [signal] cancels. Resolves the end summary.
 */
const lookUpLibrary = async (
  songs: readonly TaggableSong[],
  signal: AbortSignal,
): Promise<LibraryLookupSummary> => {
  const results: Result[] = [];
  showProgress(0, songs.length);
  const outcome = signal.aborted
    ? { stop: { stopped: "cancelled", left: songs.length } as const, error: undefined }
    : await run(songs, results, () => showProgress(results.length, songs.length), signal);
  return summarize(results, outcome);
};

/**
 * Finds lyrics and genre for every song in the Library in the background: a
 * foreground service with a progress notification and Cancel keeps it going
 * with Wave in the background and the screen off. Settings follows it with
 * `useLibraryLookup`; `cancelLibraryLookup` stops it. Ends with the updated /
 * not found / failed summary, in a notification and in Wave (now, or when Wave
 * is next on screen: `followLibraryLookupSummary`). Does nothing while one runs.
 */
export const startLibraryLookup = async (): Promise<void> => {
  if (libraryRun !== null) return;
  const controller = new AbortController();
  libraryRun = controller;
  libraryRunOver = new Promise((resolve) => {
    endLibraryRun = resolve;
  });
  askForNotifications();
  libraryLookup.set({ status: "running", done: 0, total: 0 });
  let summary: LibraryLookupSummary;
  try {
    const { title, detail } = libraryLookupProgress(0, 0);
    WaveLibraryLookup.start(title, detail);
    const songs = await appRuntime.runPromise(
      Effect.gen(function* () {
        return yield* (yield* LibraryStore).listSongs;
      }),
    );
    summary = await lookUpLibrary(songs, controller.signal);
  } catch (error) {
    summary = failedSummary(error);
  }
  libraryLookup.set({ status: "idle" });
  libraryRun = null;
  unseenSummary.set(summary);
  WaveLibraryLookup.end(summary.title, summary.message);
  endLibraryRun();
  await showUnseenLibraryLookupSummary();
};

/** Stops the Library-wide run; songs done so far keep what was written. */
export const cancelLibraryLookup = (): void => {
  libraryRun?.abort();
};

let showingSummary = false;

/**
 * Shows the last Library-wide run's summary when the owner hasn't seen it yet
 * and Wave is on screen; once it's dismissed, its notification goes too.
 */
const showUnseenLibraryLookupSummary = async (): Promise<void> => {
  const summary = unseenSummary.get();
  if (summary === null || showingSummary || AppState.currentState !== "active") return;
  showingSummary = true;
  try {
    await showMessage(summary.title, summary.message);
  } finally {
    showingSummary = false;
  }
  // A run that ended while this summary was open shows its own next.
  if (unseenSummary.get() !== summary) return showUnseenLibraryLookupSummary();
  unseenSummary.set(null);
  WaveLibraryLookup.dismissSummary();
};

let summaryOnReturn: { remove: () => void } | null = null;

/**
 * Shows the summary of a Library-wide run the owner hasn't seen (it ended with
 * Wave in the background or closed) now, and whenever Wave comes back to the
 * foreground. Safe to call repeatedly.
 */
export const followLibraryLookupSummary = (): void => {
  void showUnseenLibraryLookupSummary();
  summaryOnReturn ??= AppState.addEventListener("change", (state) => {
    if (state === "active") void showUnseenLibraryLookupSummary();
  });
};
