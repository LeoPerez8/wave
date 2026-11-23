import { registerTimingBackground, timingBackgroundChanged } from "@/lib/timing";
import { failedJobs, queuedDownloadCounts, type QueuedDownloadCounts } from "@wave/core";

import { makeExternalStore, subscribeAll } from "@wave/client/externalStore";
import type { NativeDownloadJob } from "@/native/waveSoulseek";

/**
 * The native download journal's last snapshot as it came (`YtDownloads` follows and sets it),
 * for album and playlist views (Core's `ytSongsDownload`), Settings › Downloads and the run
 * (`downloadRun`).
 */
export const journal = makeExternalStore<readonly NativeDownloadJob[]>([]);

/**
 * Whether the owner paused downloads (Settings › Downloads' or the notification's Pause), as the
 * journal keeps it; `YtDownloads` reads it with each journal change.
 */
export const downloadsPausedByOwner = makeExternalStore(false);

/**
 * The playlists, albums and other groups the owner paused on their own (#1475), by Core's
 * `downloadGroupKey` ("playlist:12", "songs"); `YtDownloads` reads it with each journal change.
 */
export const pausedDownloadGroups = makeExternalStore<readonly string[]>([]);

/** What the owner paused, everything or groups: one value for whatever shows "Paused". */
export interface OwnerPause {
  readonly all: boolean;
  readonly groups: readonly string[];
}

let ownerPauseShown: OwnerPause = { all: false, groups: [] };

/** [downloadsPausedByOwner] and [pausedDownloadGroups] together, the same value while neither changes. */
export const ownerPause = {
  get: (): OwnerPause => {
    const all = downloadsPausedByOwner.get();
    const groups = pausedDownloadGroups.get();
    if (all !== ownerPauseShown.all || groups !== ownerPauseShown.groups)
      ownerPauseShown = { all, groups };
    return ownerPauseShown;
  },
  subscribe: subscribeAll(downloadsPausedByOwner, pausedDownloadGroups),
};
// Reuse the journal's existing memoized counts, and sample only while a transition is active.
registerTimingBackground("downloads", () => {
  const counts = queuedCountsNow();
  const active = counts.downloading + counts.saving;
  return active > 0 ? `${active} downloads` : null;
});
journal.subscribe(timingBackgroundChanged);

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
