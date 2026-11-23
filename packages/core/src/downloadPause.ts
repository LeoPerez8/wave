import type { AlertSpec } from "./alert.ts";
import { catalogueOf, type AppLanguage } from "./localisation.ts";
import type { YtDownloadJournalJob, YtDownloadJournalPhase } from "./ytDownloads.ts";

/**
 * The owner's pause on downloads (Settings › Downloads' Pause and the notification's), which the
 * native journal keeps across restarts and mirrors. [all] is Pause; [released] are the jobs asked
 * for again while paused, which download anyway. Per-list pauses join it as their own field.
 */
export interface DownloadPause {
  readonly all: boolean;
  readonly released: readonly string[];
}

export const NO_DOWNLOAD_PAUSE: DownloadPause = { all: false, released: [] };

/** Pause: every song waiting or downloading stops, and nothing asked for before runs. */
export const pauseAllDownloads = (_pause: DownloadPause): DownloadPause => ({
  all: true,
  released: [],
});

/** Resume: everything paused goes on, the songs stopped mid-download from the start. */
export const resumeAllDownloads = (_pause: DownloadPause): DownloadPause => NO_DOWNLOAD_PAUSE;

/** Not downloaded yet: what Pause stops and Cancel All removes. */
const NOT_DOWNLOADED: ReadonlySet<YtDownloadJournalPhase> = new Set([
  "queued",
  "preparing",
  "prepared",
  "transferring",
]);

const notDownloaded = (job: YtDownloadJournalJob): boolean =>
  NOT_DOWNLOADED.has(job.phase) && job.importFailure === undefined;

/**
 * Whether the pause holds [job]: a song not downloaded yet, unless asked for again while paused.
 * A song already downloaded finishes saving.
 */
export const downloadHeld = (pause: DownloadPause, job: YtDownloadJournalJob): boolean =>
  pause.all && notDownloaded(job) && !pause.released.includes(job.id);

/**
 * What asked for a download: a song's Download (or a missing song's), a playlist's, album's or
 * mix's Download (again), a star, Retry, a quality replacement, or Wave on its own (YouTube's
 * requeue, a result matched to a job already queued).
 */
export type DownloadRequest = "song" | "list" | "star" | "retry" | "quality" | "background";

/** The owner's new requests download while paused; the rest waits for Resume. */
export const requestRunsWhilePaused = (request: DownloadRequest): boolean =>
  request === "song" || request === "list" || request === "star";

/** Jobs [ids] asked for by [request]: while paused, a new request downloads them anyway. */
export const downloadRequested = (
  pause: DownloadPause,
  ids: readonly string[],
  request: DownloadRequest,
): DownloadPause => {
  if (!pause.all || !requestRunsWhilePaused(request)) return pause;
  const added = ids.filter((id) => !pause.released.includes(id));
  return added.length === 0 ? pause : { ...pause, released: [...pause.released, ...added] };
};

/** Cancel All's songs: every one waiting or downloading. Downloaded and failed songs stay. */
export const downloadsToCancelAll = (jobs: readonly YtDownloadJournalJob[]): string[] =>
  jobs.filter(notDownloaded).map((job) => job.id);

/** Downloads' Cancel All asks first ("Cancel 12 downloads?"); the notification's doesn't. */
export const cancelAllDownloadsAlert = (
  count: number,
  language: AppLanguage = "en",
): AlertSpec & { readonly action: NonNullable<AlertSpec["action"]> } => {
  const t = catalogueOf(language).downloads.run;
  return {
    title: t.cancelAllTitle(count),
    message: t.cancelAllMessage,
    action: { label: t.cancelAll, destructive: true },
    dismissLabel: t.keepDownloading,
  };
};
