/**
 * Link imports in the background (docs/spec.md, "Importing playlists from a
 * link"): Import makes the playlist at once, and this fills it, one import
 * at a time, while Wave is open or in the background (a foreground service,
 * `WavePlaylistImport`, with progress and Cancel in a notification). Core
 * decides each step (`nextImportStep`), what a search's answer settles
 * (`importSearchAnswered`) and what the playlist is given next
 * (`importAdditions`); each search waits its turn in the allowance every
 * automatic YouTube Music search shares (`searchTurn`). The imports are
 * kept, so they go on when Wave starts again, and the app log notes each
 * one's start, pauses, stop, Cancel, Try Again and end (`importLogLine`).
 */
import {
  IMPORT_PROGRESS_SHOWN_EVERY_MS,
  importAdded,
  importAdditions,
  importLogLine,
  importProgressOnly,
  importSearchAnswered,
  importTurn,
  nextImportStep,
  playlistImportProgress,
  queuePlaylistImport,
  readPlaylistImports,
  retryPlaylistImport,
  startPlaylistImport,
  updatePlaylistImport,
  withoutPlaylistImport,
  writePlaylistImports,
  type ImportAdditions,
  type ImportLogEvent,
  type ImportRun,
  type LinkImportPlan,
  type PlaylistImport,
  type PlaylistImports,
  type SearchAllowance,
  type YtAlbumSong,
  type YtSongSearch,
} from "@wave/core";
import * as Result from "effect/Result";
import { useSyncExternalStore } from "react";

import { askForNotifications } from "@/lib/askForNotifications";
import { freeTurn } from "@/lib/backgroundWork";
import { makeExternalStore } from "@/lib/externalStore";
import { persistedSetting } from "@/lib/persistedSetting";
import { appLog } from "@/log/appLog";
import { WavePlaylistImport } from "@/native/wavePlaylistImport";
import { showError } from "@/overlay/alert";
import { perfMark, registerPerfMeta } from "@/perf/perf";
import { askYtMusic } from "@/ytmusic/askYtMusic";
import {
  logSearchFailure,
  onSearchWait,
  searchTurn,
  searchesAsked,
} from "@/ytmusic/searchAllowance";

import { playlistWorkReport } from "./db/playlistWork";
import { addToPlaylist, currentPlaylists } from "./playlists";

type Job = PlaylistImport<YtAlbumSong>;

/**
 * The imports going on, waiting, stopped, or done with songs not found, kept
 * until Wave starts again. Written once a second while answers come (a
 * steady stream doesn't put the write off), and at once when Wave leaves the
 * foreground, so a Wave killed mid-import goes on from at most a second
 * back: a song given the playlist but not yet counted here isn't given
 * twice, as a playlist doesn't take a song it holds.
 */
const imports = persistedSetting<PlaylistImports<YtAlbumSong>>({
  key: "playlistImports",
  read: readPlaylistImports,
  write: (value) => (value.length === 0 ? null : writePlaylistImports(value)),
  persistDelayMs: 1000,
  persistMaxDelayMs: 1000,
});

/** The imports as shown, and the searches asked lately as they were then (the page's time left). */
interface Shown {
  readonly imports: PlaylistImports<YtAlbumSong>;
  readonly searches: SearchAllowance;
}

/**
 * The imports as the playlist page and the notification show them: how far
 * they got at most once a second (Core's `importProgressOnly`), anything
 * else at once. Null until the imports first change.
 */
const shown = makeExternalStore<Shown | null>(null);
let showTimer: ReturnType<typeof setTimeout> | undefined;
/** Progress notifications sent, for a perf build's runs. */
let progressShown = 0;

/** What a page read before the imports first changed: the same object until then. */
let unchanged: Shown | null = null;

/**
 * What's shown now, the same object until `shown` tells its subscribers it
 * changed (`useSyncExternalStore`'s contract): the imports and the searches
 * move together.
 */
const shownNow = (): Shown =>
  shown.get() ?? (unchanged ??= { imports: imports.get(), searches: searchesAsked() });

/** Shows the imports as they are now: the page's line and the notification. */
const show = (): void => {
  clearTimeout(showTimer);
  showTimer = undefined;
  const now = { imports: imports.get(), searches: searchesAsked() };
  const last = shown.get();
  if (last?.imports !== now.imports || last.searches !== now.searches) shown.set(now);
  showProgress();
};

/** The imports changed from [before]: shown at once, or with the next progress shown. */
const follow = (before: PlaylistImports<YtAlbumSong>): void => {
  // What was shown before the first change (a page may have read it already).
  if (shown.get() === null)
    shown.set(unchanged ?? { imports: before, searches: searchesAsked() });
  if (!importProgressOnly(shownNow().imports, imports.get())) show();
  else showTimer ??= setTimeout(show, IMPORT_PROGRESS_SHOWN_EVERY_MS);
};

/** The imports, for the playlist page; re-renders as they go on, progress at most once a second. */
export const usePlaylistImports = (): PlaylistImports<YtAlbumSong> =>
  useSyncExternalStore(shown.subscribe, shownNow).imports;

/**
 * The YouTube Music searches asked lately, for the playlist page's time
 * left: as they were when the imports were last shown (`usePlaylistImports`),
 * not per search, so the time left agrees with the progress shown.
 */
export const useSearchesAsked = (): SearchAllowance =>
  useSyncExternalStore(shown.subscribe, shownNow).searches;

/** While the playlist is given found songs: at most once a second, so its page doesn't redraw for each. */
const GIVE_EVERY_MS = 1000;

/** Whether the imports are running, their service and notification up. */
let running = false;

// ---------------------------------------------------------------------------
// Waking the import going on

const sleepers = new Set<() => void>();

/** Wakes the import going on: an answer came, or the imports changed. */
const wake = (): void => {
  // Each sleeper only removes itself, which a Set's iteration allows.
  for (const sleeper of sleepers) sleeper();
};

/** Resolves after [ms] (never, when null), or once `wake` is called. */
const sleep = (ms: number | null): Promise<void> =>
  new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      sleepers.delete(done);
      resolve();
    };
    const timer = ms === null ? undefined : setTimeout(done, ms);
    sleepers.add(done);
  });

const find = (playlistId: number): Job | undefined =>
  imports.get().find((job) => job.playlistId === playlistId);

/** Shows the import going on in the notification, while the service runs. */
const showProgress = (): void => {
  if (!running) return;
  const progress = playlistImportProgress(imports.get());
  if (progress === null) return;
  progressShown += 1;
  WavePlaylistImport.progress(progress.title, progress.detail, progress.done, progress.total);
};

const setImports = (next: PlaylistImports<YtAlbumSong>): void => {
  const before = imports.get();
  imports.set(next);
  follow(before);
  wake();
};

/** [playlistId]'s import, changed by [change]; nothing when it's gone (cancelled meanwhile). */
const updateImport = (playlistId: number, change: (job: Job) => Job): void => {
  const job = find(playlistId);
  if (job === undefined) return;
  const changed = change(job);
  setImports(updatePlaylistImport(imports.get(), changed));
  noteChange(job, changed);
};

// ---------------------------------------------------------------------------
// The app log

const LOG_TAG = "WaveImport";

/** Each import's run while Wave runs, for its last line: since it started, or went on after a restart. */
const runs = new Map<number, ImportRun>();
/** The imports started while Wave runs, so the others went on after a restart. */
const startedHere = new Set<number>();

const logImport = (job: Job, event: ImportLogEvent): void =>
  appLog("info", LOG_TAG, importLogLine(job, event));

/** Notes in the log what [before] becoming [after] did: a stop, or the end. */
const noteChange = (before: Job, after: Job): void => {
  const run = runs.get(after.playlistId);
  // A stopped import keeps its run: Try Again goes on with it.
  if (before.state.kind === "importing" && after.state.kind === "stopped") {
    logImport(after, { kind: "stopped" });
  } else if (before.state.kind === "importing" && after.state.kind === "done") {
    if (run !== undefined) logImport(after, { kind: "done", run, now: Date.now() });
    runs.delete(after.playlistId);
  }
};

/** Counts into [playlistId]'s run. */
const countRun = (playlistId: number, change: (run: ImportRun) => ImportRun): void => {
  const run = runs.get(playlistId);
  if (run !== undefined) runs.set(playlistId, change(run));
};

// The import going on adds up the time its searches waited for the allowance.
onSearchWait((wait) => {
  if (wait.asker !== "import" || wait.kind !== "ended") return;
  const job = importTurn(imports.get());
  const waited = wait.at - wait.since;
  if (job !== null) countRun(job.playlistId, (run) => ({ ...run, waitedMs: run.waitedMs + waited }));
});

// ---------------------------------------------------------------------------
// Running the imports

/** Gives up an import's searches still waiting for their turn once it stops or is cancelled. */
const turnsGivenUp = new Map<number, AbortController>();

const importSignal = (playlistId: number): AbortSignal => {
  let controller = turnsGivenUp.get(playlistId);
  if (controller === undefined) {
    controller = new AbortController();
    turnsGivenUp.set(playlistId, controller);
  }
  return controller.signal;
};

const giveUpTurns = (playlistId: number): void => {
  turnsGivenUp.get(playlistId)?.abort();
  turnsGivenUp.delete(playlistId);
};

/** One YT Music Songs search: the song's title and artists only. Never rejects. */
const searchYtSongs = async (query: string): Promise<YtSongSearch<YtAlbumSong>> => {
  try {
    const answer = await askYtMusic((ytMusic) => ytMusic.searchSongs(query));
    return Result.isFailure(answer)
      ? { ok: false, reason: answer.failure.reason }
      : { ok: true, songs: answer.success.songs };
  } catch {
    return { ok: false, reason: "failed" };
  }
};

/**
 * Asks [query] for [playlistId]'s import once its turn in the search
 * allowance comes; its answer settles what it finds, whenever it comes. A
 * failure is logged, and a pause after a refusal too.
 */
const ask = (playlistId: number, query: string): void => {
  void (async () => {
    if (!(await searchTurn("import", importSignal(playlistId)))) return;
    countRun(playlistId, (run) => ({ ...run, searches: run.searches + 1 }));
    const answer = await searchYtSongs(query);
    if (!answer.ok) {
      logSearchFailure("import", query, answer.reason);
      if (answer.reason === "failed")
        countRun(playlistId, (run) => ({ ...run, refusals: run.refusals + 1 }));
    }
    const now = Date.now();
    updateImport(playlistId, (job) => {
      const answered = importSearchAnswered(job, query, answer, now);
      if (answered.pausedUntil > job.pausedUntil && answered.state.kind === "importing")
        logImport(answered, { kind: "paused", query, now });
      return answered;
    });
  })();
};

/**
 * Gives [playlistId]'s playlist [additions], then counts them as given. A
 * playlist deleted meanwhile (here or on another phone) ends its import.
 */
const give = async (
  playlistId: number,
  { songs, through }: ImportAdditions<YtAlbumSong>,
): Promise<void> => {
  try {
    // Additions as the import fills: screens take them at their own pace, hidden ones on return.
    if (songs.length > 0) await addToPlaylist(playlistId, songs, { burst: true });
  } catch (error) {
    const kept = (await currentPlaylists().catch(() => [])).some(({ id }) => id === playlistId);
    setImports(withoutPlaylistImport(imports.get(), playlistId));
    if (kept) void showError("Couldn't import the playlist", error);
    return;
  }
  updateImport(playlistId, (job) => importAdded(job, through));
};

/** Runs [playlistId]'s import while it's the one going on: cancelled, stopped or done, it returns. */
const runImport = async (playlistId: number): Promise<void> => {
  let givenAt = 0;
  /** A free turn was just taken for the next give: the import is read again first. */
  let turnTaken = false;
  const first = find(playlistId);
  if (first !== undefined && !runs.has(playlistId)) {
    const resumed = !startedHere.has(playlistId);
    runs.set(playlistId, { startedAt: Date.now(), searches: 0, refusals: 0, waitedMs: 0, resumed });
    logImport(first, { kind: "started", resumed });
  }
  for (;;) {
    const job = importTurn(imports.get());
    if (job === null || job.playlistId !== playlistId) {
      giveUpTurns(playlistId);
      // Stopped: the songs found before it stopped still go in.
      const stopped = find(playlistId);
      if (stopped?.state.kind === "stopped") {
        const additions = importAdditions(stopped);
        if (additions.through > stopped.added) await give(playlistId, additions);
      }
      return;
    }
    const now = Date.now();
    const { job: next, step } = nextImportStep(job, now);
    if (step.kind === "search") {
      turnTaken = false;
      setImports(updatePlaylistImport(imports.get(), next));
      ask(playlistId, step.query);
      continue;
    }
    const additions = importAdditions(job);
    const toGive = additions.through > job.added;
    if (toGive && (step.kind === "none" || now - givenAt >= GIVE_EVERY_MS)) {
      // Writing to the playlist holds the JavaScript thread: not while the owner taps.
      if (!turnTaken) {
        await freeTurn();
        turnTaken = true;
        continue;
      }
      turnTaken = false;
      givenAt = now;
      await give(playlistId, additions);
      continue;
    }
    if (step.kind === "none") return;
    turnTaken = false;
    const until = Math.min(
      step.kind === "wait" ? step.untilMs : Infinity,
      toGive ? givenAt + GIVE_EVERY_MS : Infinity,
    );
    await sleep(until === Infinity ? null : Math.max(0, until - now));
  }
};

/**
 * Runs the imports in turn until none is left going on, in a foreground
 * service with a progress notification. Does nothing while they run.
 */
const runImports = async (): Promise<void> => {
  if (running || importTurn(imports.get()) === null) return;
  running = true;
  const first = playlistImportProgress(imports.get());
  perfMark("import.running", String(first?.total ?? 0));
  WavePlaylistImport.start(first?.title ?? "Importing playlists", first?.detail ?? null);
  showProgress();
  try {
    for (let job = importTurn(imports.get()); job !== null; job = importTurn(imports.get())) {
      await runImport(job.playlistId);
    }
  } catch (error) {
    void showError("Couldn't import the playlist", error);
  } finally {
    running = false;
    WavePlaylistImport.end();
    perfMark("import.idle");
  }
};

// A perf build's runs record how far the import going on has got (docs/performance/README.md).
registerPerfMeta("import", () => {
  const progress = playlistImportProgress(imports.get());
  return { running, done: progress?.done ?? null, total: progress?.total ?? null, progressShown };
});

// And what the playlists cost meanwhile: the imports' own, and the others' (#308).
registerPerfMeta("playlistWork", () =>
  playlistWorkReport(imports.get().map((job) => job.playlistId)),
);

// ---------------------------------------------------------------------------
// What the app asks

/**
 * Imports [plan] into the playlist Import just made, [playlistId] named
 * [name]: the songs go in as they're found, after any import already going
 * on. Replaces an import into that playlist.
 */
export const startLinkImport = (
  plan: LinkImportPlan<YtAlbumSong>,
  { playlistId, name }: { readonly playlistId: number; readonly name: string },
): void => {
  askForNotifications();
  giveUpTurns(playlistId);
  runs.delete(playlistId);
  startedHere.add(playlistId);
  setImports(queuePlaylistImport(imports.get(), startPlaylistImport(plan, { playlistId, name })));
  void runImports();
};

/**
 * Cancel (on the playlist page or in the notification), or the playlist
 * deleted or replaced: [playlistId]'s import stops, keeping the songs it gave
 * the playlist, and the next goes on. Also dismisses the songs not found.
 */
export const cancelPlaylistImport = (playlistId: number): void => {
  const job = find(playlistId);
  if (job === undefined) return;
  if (job.state.kind !== "done") logImport(job, { kind: "cancelled" });
  giveUpTurns(playlistId);
  runs.delete(playlistId);
  setImports(withoutPlaylistImport(imports.get(), playlistId));
};

/** Try Again on a stopped import: it goes on from where it got to, after the others. */
export const tryPlaylistImportAgain = (playlistId: number): void => {
  const job = find(playlistId);
  if (job?.state.kind === "stopped") logImport(job, { kind: "retried" });
  setImports(retryPlaylistImport(imports.get(), playlistId));
  void runImports();
};

/** Goes on with the imports kept when Wave last closed. Safe to call repeatedly. */
export const resumePlaylistImports = (): void => {
  void runImports();
};

// Cancel in the notification: the import going on now.
WavePlaylistImport.addListener("onCancel", () => {
  const job = importTurn(imports.get());
  if (job !== null) cancelPlaylistImport(job.playlistId);
});
