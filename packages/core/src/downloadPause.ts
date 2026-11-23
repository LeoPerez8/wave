import type { AlertSpec } from "./alert.ts";
import { downloadGroupKey, type DownloadOrigin } from "./downloadGroups.ts";
import { catalogueOf, type AppLanguage } from "./localisation.ts";
import type { YtDownloadJournalJob, YtDownloadJournalPhase } from "./ytDownloads.ts";

/**
 * The owner's pause on downloads (Settings › Downloads' Pause and the notification's), which the
 * native journal keeps across restarts and mirrors. [all] is Pause; [released] are the jobs asked
 * for again while paused, which download anyway. [groups] are the playlists, albums and other
 * groups paused on their own (#1475), by their key (`downloadGroupKey`: "playlist:12", "songs").
 */
export interface DownloadPause {
  readonly all: boolean;
  readonly released: readonly string[];
  readonly groups: readonly string[];
}

export const NO_DOWNLOAD_PAUSE: DownloadPause = { all: false, released: [], groups: [] };

/**
 * Pause: every song waiting or downloading stops, and nothing asked for before runs. The groups
 * paused on their own stay paused under it, and Resume resumes them too.
 */
export const pauseAllDownloads = (pause: DownloadPause): DownloadPause => ({
  ...pause,
  all: true,
  released: [],
});

/** Resume: everything paused goes on, every paused group too, the songs stopped mid-download from the start. */
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

/** The group [job] waits in on Settings › Downloads (`downloadGroupKey` of its origin). */
const groupOf = (job: YtDownloadJournalJob): string => downloadGroupKey(job.origin ?? null);

/**
 * A group's Pause (its page, its menu, its header in Settings › Downloads): its songs waiting or
 * downloading stop at once, and the other groups go on. Its songs asked for on their own since
 * an earlier pause ([jobs], the journal's, say which) stop with it.
 */
export const pauseDownloadGroup = (
  pause: DownloadPause,
  key: string,
  jobs: readonly YtDownloadJournalJob[],
): DownloadPause => {
  const inGroup = new Set(jobs.filter((job) => groupOf(job) === key).map((job) => job.id));
  return {
    ...pause,
    released: pause.released.filter((id) => !inGroup.has(id)),
    groups: pause.groups.includes(key) ? pause.groups : [...pause.groups, key],
  };
};

/** A group's Resume: its songs go on, the ones stopped mid-download from the start. */
export const resumeDownloadGroup = (pause: DownloadPause, key: string): DownloadPause => {
  if (!pause.groups.includes(key)) return pause;
  const groups = pause.groups.filter((group) => group !== key);
  return !pause.all && groups.length === 0 ? NO_DOWNLOAD_PAUSE : { ...pause, groups };
};

/** Whether the group [key] is paused on its own (its line says "Paused · 3 of 10"). */
export const downloadGroupPaused = (pause: DownloadPause, key: string): boolean =>
  pause.groups.includes(key);

/**
 * Whether the pause holds [job]: a song not downloaded yet, while every download or its group is
 * paused, unless asked for again since. A song already downloaded finishes saving.
 */
export const downloadHeld = (pause: DownloadPause, job: YtDownloadJournalJob): boolean =>
  (pause.all || pause.groups.includes(groupOf(job))) &&
  notDownloaded(job) &&
  !pause.released.includes(job.id);

/**
 * What asked for a download: a song's Download (or a missing song's), a playlist's, album's or
 * mix's Download (again), a star, Retry, a quality replacement, or Wave on its own (YouTube's
 * requeue, a result matched to a job already queued).
 */
export type DownloadRequest = "song" | "list" | "star" | "retry" | "quality" | "background";

/** The owner's new requests download while paused; the rest waits for Resume. */
export const requestRunsWhilePaused = (request: DownloadRequest): boolean =>
  request === "song" || request === "list" || request === "star";

/** A list's Download (again) resumes its paused group (Download Playlist, Download Album). */
export const requestResumesGroup = (request: DownloadRequest): boolean => request === "list";

/**
 * Jobs [ids] asked for by [request], from [origin] (the playlist, album or mix whose Download it
 * was): a list's Download resumes that list's paused group, and while anything is paused, a new
 * request downloads its songs anyway.
 */
export const downloadRequested = (
  pause: DownloadPause,
  ids: readonly string[],
  request: DownloadRequest,
  origin?: DownloadOrigin | null,
): DownloadPause => {
  const resumed =
    requestResumesGroup(request) && origin !== undefined
      ? resumeDownloadGroup(pause, downloadGroupKey(origin))
      : pause;
  if ((!resumed.all && resumed.groups.length === 0) || !requestRunsWhilePaused(request))
    return resumed;
  const added = ids.filter((id) => !resumed.released.includes(id));
  return added.length === 0 ? resumed : { ...resumed, released: [...resumed.released, ...added] };
};

/** Cancel All's songs: every one waiting or downloading. Downloaded and failed songs stay. */
export const downloadsToCancelAll = (jobs: readonly YtDownloadJournalJob[]): string[] =>
  jobs.filter(notDownloaded).map((job) => job.id);

/** A group's Cancel: its songs waiting or downloading. Downloaded and failed songs stay. */
export const downloadsToCancelInGroup = (
  jobs: readonly YtDownloadJournalJob[],
  key: string,
): string[] => jobs.filter((job) => notDownloaded(job) && groupOf(job) === key).map((job) => job.id);

/** A group's Pause or Resume, and the songs its Cancel takes. */
export interface DownloadGroupControls {
  /** Paused on its own or by the global Pause: it offers Resume. */
  readonly paused: boolean;
  readonly toCancel: readonly string[];
}

/**
 * A group's Pause or Resume and Cancel, where its page and its header offer them: Resume while
 * it's paused, on its own or with every download, and what Cancel takes. Null while none of its
 * songs is waiting or downloading.
 */
export const downloadGroupControls = (
  pause: DownloadPause,
  jobs: readonly YtDownloadJournalJob[],
  key: string,
): DownloadGroupControls | null => {
  const toCancel = downloadsToCancelInGroup(jobs, key);
  if (toCancel.length === 0) return null;
  return { paused: pause.all || pause.groups.includes(key), toCancel };
};

/** A group's Cancel asks first ("Cancel 12 downloads?"). */
export const cancelGroupDownloadsAlert = (
  count: number,
  language: AppLanguage = "en",
): AlertSpec & { readonly action: NonNullable<AlertSpec["action"]> } => {
  const t = catalogueOf(language).downloads.run;
  return {
    title: t.cancelAllTitle(count),
    message: t.cancelGroupMessage,
    action: { label: t.cancelGroup, destructive: true },
    dismissLabel: t.keepDownloading,
  };
};

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
