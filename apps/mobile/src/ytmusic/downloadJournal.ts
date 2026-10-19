import { failedJobs, queuedDownloadCounts, type QueuedDownloadCounts } from "@wave/core";

import { makeExternalStore } from "@/lib/externalStore";
import type { NativeDownloadJob } from "@/native/waveSoulseek";

/**
 * The native download journal's last snapshot as it came (`YtDownloads` follows and sets it),
 * for album and playlist views (Core's `ytSongsDownload`), Settings › Downloads and the run
 * (`downloadRun`).
 */
export const journal = makeExternalStore<readonly NativeDownloadJob[]>([]);

/**
 * A reading of the journal, for `useSyncExternalStore`: [compute]d again only once the journal
 * changed, from it and what it gave last; the value before stays while [same] says nothing
 * changed, so what reads it doesn't render again.
 */
const selectFromJournal = <A>(
  compute: (jobs: readonly NativeDownloadJob[], before: A) => A,
  initial: A,
  same: (next: A, before: A) => boolean = Object.is,
): (() => A) => {
  let shown = { jobs: journal.get(), value: initial };
  return () => {
    const jobs = journal.get();
    if (jobs === shown.jobs) return shown.value;
    const next = compute(jobs, shown.value);
    shown = { jobs, value: same(next, shown.value) ? shown.value : next };
    return shown.value;
  };
};

/**
 * The journal's failed jobs (Core's `failedJobs`): the same array until a failure comes, goes or
 * changes, so the failed rows aren't built again on each tick of the songs on their way.
 */
export const failedJobsNow = selectFromJournal<readonly NativeDownloadJob[]>(
  (jobs, before) => failedJobs(jobs, before),
  [],
);

/** The journal's queued counts (Core's `queuedDownloadCounts`), the same object while they're the same. */
export const queuedCountsNow = selectFromJournal<QueuedDownloadCounts>(
  (jobs) => queuedDownloadCounts(jobs),
  { downloading: 0, saving: 0, waiting: 0 },
  (next, before) =>
    next.downloading === before.downloading &&
    next.saving === before.saving &&
    next.waiting === before.waiting,
);
