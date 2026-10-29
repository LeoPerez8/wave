import { currentLocalisation } from "@/localisation/localisation";
/**
 * Fix Song as the owner starts it: on songs from a menu or the selection bar,
 * or on the whole Library from Settings. Every run goes on in the background
 * (a foreground service, `WaveLibraryLookup`) with progress and Cancel in
 * Settings and in a notification, one at a time: songs started while one runs
 * join it. Each works only on the songs missing something (Core's
 * `songsToFix`) and ends with Core's summary (`tagLookupsToast`) on a toast.
 */
import {
  describeTagLookups,
  libraryLookupProgress,
  readLibraryLookupSummary,
  writeLibraryLookupSummary,
  type LibraryLookupSummary,
  songsToFix,
  type SongTagOutcome,
  tagLookupsToast,
  type TagLookupStop,
} from "@wave/core";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { useSyncExternalStore } from "react";
import { AppState } from "react-native";

import { askForNotifications } from "@/lib/askForNotifications";
import { makeExternalStore } from "@/lib/externalStore";
import { persistedSetting } from "@/lib/persistedSetting";
import { appLog } from "@/log/appLog";
import { WaveLibraryLookup } from "@/native/waveLibraryLookup";
import { showToast } from "@/overlay/toast";

import { LibraryStore } from "./LibraryStore";
import { fixEachSong, LookupsOff, type TaggableSong } from "./lyricsAndGenre";
import { appRuntime } from "./runtime";

type Result = { readonly title: string; readonly outcome: SongTagOutcome };

const TAG = "WaveLookup";

/**
 * The Fix Songs run going on: its songs in order (a Fix Songs started while
 * it runs adds its own at the end), the files it was given (fixed or
 * skipped), the results so far, how many songs it skipped as having
 * everything, and its Cancel.
 */
interface FixRun {
  readonly songs: TaggableSong[];
  readonly given: Set<string>;
  readonly results: Result[];
  skipped: number;
  readonly controller: AbortController;
}

let fixRun: FixRun | null = null;
/** Settles when the last run has ended: a cancelled one winds down before the next starts. */
let runEnded: Promise<void> = Promise.resolve();

/** How a run ended: why it stopped early, or what failed it. */
interface RunOutcome {
  readonly stop: TagLookupStop | undefined;
  readonly error: unknown;
}

/** The run's progress, for Settings: idle, or [done] of [total] songs. */
export type FixSongsRunState =
  | { readonly status: "idle" }
  | { readonly status: "running"; readonly done: number; readonly total: number };

const runState = makeExternalStore<FixSongsRunState>({ status: "idle" });

/** The Fix Songs run's progress; re-renders as songs are done. */
export const useFixSongsRun = (): FixSongsRunState =>
  useSyncExternalStore(runState.subscribe, runState.get);

/** Shows how far [run] is in Settings and in the notification. */
const showProgress = (run: FixRun): void => {
  const done = run.results.length;
  const total = run.songs.length;
  runState.set({ status: "running", done, total });
  const { title, detail } = libraryLookupProgress(done, total, currentLocalisation().strings);
  WaveLibraryLookup.progress(title, detail, done, total);
};

/** The songs [run] hasn't done yet. */
const left = (run: FixRun): number => run.songs.length - run.results.length;

/**
 * Runs Fix Song on the songs [run] hasn't done yet, collecting results. Songs
 * joining meanwhile wait for the next pass (`fixAll`).
 */
const pass = async (run: FixRun): Promise<RunOutcome> => {
  const exit = await appRuntime.runPromiseExit(
    fixEachSong(run.songs.slice(run.results.length), (song, outcome) => {
      run.results.push({ title: song.title, outcome });
      showProgress(run);
    }),
    { signal: run.controller.signal },
  );
  if (Exit.isSuccess(exit))
    return {
      stop: exit.value === "unreachable" ? { stopped: "unreachable", left: left(run) } : undefined,
      error: undefined,
    };
  const error = Cause.squash(exit.cause);
  // Cancel, or Settings turning lookups off halfway: the songs left aren't looked up.
  if (Cause.hasInterruptsOnly(exit.cause) || error instanceof LookupsOff)
    return { stop: { stopped: "cancelled", left: left(run) }, error: undefined };
  return { stop: undefined, error };
};

/**
 * Fixes [run]'s songs until all are done or it stops, a pass at a time: each
 * takes the songs that joined during the one before.
 */
const fixAll = async (run: FixRun): Promise<RunOutcome> => {
  while (left(run) > 0) {
    // Cancelled while its songs were picked, or between passes.
    if (run.controller.signal.aborted)
      return { stop: { stopped: "cancelled", left: left(run) }, error: undefined };
    const outcome = await pass(run);
    if (outcome.stop !== undefined || outcome.error !== undefined) return outcome;
  }
  return { stop: undefined, error: undefined };
};

const failedSummary = (error: unknown): LibraryLookupSummary => {
  const message = error instanceof Error ? error.message : String(error);
  const { settings } = currentLocalisation().strings;
  return {
    title: settings.couldntFixSongs,
    message,
    toast: settings.couldntFixSongsToast(message),
  };
};

/**
 * How [run] went, in full and as its toast says it: Core's summary, or what
 * went wrong when the run failed before anything was looked up.
 */
const summarize = (run: FixRun, outcome: RunOutcome): LibraryLookupSummary =>
  outcome.error !== undefined && run.results.length === 0
    ? failedSummary(outcome.error)
    : {
        ...describeTagLookups(
          run.results,
          outcome.stop,
          run.skipped,
          currentLocalisation().strings,
        ),
        toast: tagLookupsToast(
          run.results,
          outcome.stop,
          run.skipped,
          currentLocalisation().strings,
        ),
      };

/**
 * Adds those of [songs] Fix Song can do something for that [run] doesn't hold
 * yet to it, counting the others as skipped; resolves how many it added.
 */
const join = (run: FixRun, songs: readonly TaggableSong[]): number => {
  const { fix, skipped } = songsToFix(songs, run.given);
  for (const song of songs) run.given.add(song.path);
  // One push at a time: spreading a whole Library's songs into one call can overflow the stack.
  for (const song of fix) run.songs.push(song);
  run.skipped += skipped;
  if (fix.length > 0) showProgress(run);
  return fix.length;
};

/**
 * The run's end summary, kept until the owner has seen it in Wave: a run that
 * ends with Wave in the background (or closed) shows it when Wave is back.
 */
const unseenSummary = persistedSetting<LibraryLookupSummary | null>({
  key: "lyricsAndGenre.unseenLibrarySummary",
  read: readLibraryLookupSummary,
  write: (summary) => (summary === null ? null : writeLibraryLookupSummary(summary)),
});

// Cancel in the run's notification.
WaveLibraryLookup.addListener("onCancel", () => cancelFixSongs());

/**
 * Starts a run on the songs [pick] resolves, [from] where (for the log), in
 * the background: a foreground service with a progress notification and
 * Cancel keeps it going with Wave in the background and the screen off.
 * Fix Songs started meanwhile join it. Ends with the updated / not found /
 * failed summary and the songs skipped as having everything, in a
 * notification and in Wave (now, or when Wave is next on screen:
 * `followFixSongsSummary`).
 */
const startRun = async (
  from: string,
  pick: () => Promise<readonly TaggableSong[]>,
): Promise<void> => {
  let ended!: () => void;
  runEnded = new Promise((resolve) => {
    ended = resolve;
  });
  const run: FixRun = {
    songs: [],
    given: new Set(),
    results: [],
    skipped: 0,
    controller: new AbortController(),
  };
  fixRun = run;
  askForNotifications();
  runState.set({ status: "running", done: 0, total: 0 });
  let summary: LibraryLookupSummary;
  try {
    const { title, detail } = libraryLookupProgress(0, 0, currentLocalisation().strings);
    WaveLibraryLookup.start(title, detail);
    const added = join(run, await pick());
    appLog("info", TAG, `Fix Songs started on ${added} songs from ${from}`);
    summary = summarize(run, await fixAll(run));
  } catch (error) {
    summary = failedSummary(error);
  }
  runState.set({ status: "idle" });
  fixRun = null;
  appLog("info", TAG, `Fix Songs ended: ${summary.toast}`);
  unseenSummary.set(summary);
  WaveLibraryLookup.end(summary.title, summary.message);
  ended();
  await showUnseenFixSongsSummary();
};

/**
 * Fix Song on songs from a long-press menu or the selection bar, in the
 * background: those missing something (Core's `songsToFix`) are looked up
 * one after another, and what they lack is written. With a run going on,
 * they join it. With none missing anything, nothing runs.
 */
export const fixSongs = async (songs: readonly TaggableSong[]): Promise<void> => {
  if (fixRun !== null && !fixRun.controller.signal.aborted) {
    const added = join(fixRun, songs);
    if (added > 0) appLog("info", TAG, `Fix Songs added ${added} songs to the run`);
    return;
  }
  if (songsToFix(songs).fix.length === 0) return;
  // A cancelled run winds down first; one started meanwhile takes these songs.
  await runEnded;
  if (fixRun !== null) return fixSongs(songs);
  await startRun("a menu", async () => songs);
};

/**
 * Fix Song on the songs in the Library missing lyrics, a genre, a track
 * number, a year or a checked explicit flag (Core's `songsToFix`), in the
 * background. Does nothing while a run goes on.
 */
export const startLibraryLookup = async (): Promise<void> => {
  if (fixRun !== null) return;
  await startRun("the whole Library", () =>
    appRuntime.runPromise(
      Effect.gen(function* () {
        return yield* (yield* LibraryStore).listLibraryLookupSongs;
      }),
    ),
  );
};

/** Stops the run; songs done so far keep what was written. */
export const cancelFixSongs = (): void => {
  fixRun?.controller.abort();
};

let showingSummary = false;

/**
 * Shows the last run's summary as a toast when the owner hasn't seen it yet
 * and Wave is on screen; once the toast has gone, its notification goes too.
 */
const showUnseenFixSongsSummary = async (): Promise<void> => {
  const summary = unseenSummary.get();
  if (summary === null || showingSummary || AppState.currentState !== "active") return;
  showingSummary = true;
  try {
    await showToast(summary.toast);
  } finally {
    showingSummary = false;
  }
  // A run that ended while this summary showed shows its own next.
  if (unseenSummary.get() !== summary) return showUnseenFixSongsSummary();
  unseenSummary.set(null);
  WaveLibraryLookup.dismissSummary();
};

let summaryOnReturn: { remove: () => void } | null = null;

/**
 * Shows the summary of a run the owner hasn't seen (it ended with Wave in the
 * background or closed) now, and whenever Wave comes back to the foreground.
 * Safe to call repeatedly.
 */
export const followFixSongsSummary = (): void => {
  void showUnseenFixSongsSummary();
  summaryOnReturn ??= AppState.addEventListener("change", (state) => {
    if (state === "active") void showUnseenFixSongsSummary();
  });
};
