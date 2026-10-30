/**
 * Settings › Downloads: the songs on their way, above the failed ones, each
 * with the progress line its row shows elsewhere and Cancel. The native
 * journal's queue downloads up to five songs at once, in the order they were
 * asked for; a song leaves this list for the failed one when it fails, and
 * for good once it's in the Library.
 */

import { en, type Catalogue } from "./catalogueEn.ts";
import type { YtSong } from "./ytMusic.ts";
import {
  ytDownloadLine,
  ytDownloadsFromJournal,
  type YtDownloadJournalJob,
  type YtDownloadStatus,
} from "./ytDownloads.ts";

/** One song on its way as its row on the Downloads page shows it. */
export interface QueuedDownload<S extends YtSong = YtSong> {
  /** The journal's job. */
  readonly id: string;
  readonly song: S;
  /** Where its download is, as the song's row says it elsewhere. */
  readonly line: string;
  /**
   * Still in the queue, behind the songs downloading (up to five at once,
   * ten started); false from the moment it starts until it's in the Library.
   */
  readonly waiting: boolean;
  /**
   * The video ids Cancel cancels: every one asked for on the job, since each
   * requester leaves a shared job on its own. Null once it's saving to the
   * Library, too late to cancel (its menu offers no Cancel Download then).
   */
  readonly cancel: readonly string[] | null;
}

/** [job]'s status as rows show it, or null once it's cancelled. */
const statusOf = <S extends YtSong>(job: YtDownloadJournalJob<S>): YtDownloadStatus | null =>
  ytDownloadsFromJournal([job]).jobs[0]?.status ?? null;

type Stage = "downloading" | "saving" | "waiting";

/**
 * Where a job on its way is in the queue: started and holding a slot (tagging
 * included, which keeps its slot), downloaded and waiting its turn to be saved
 * to the Library, or not started yet.
 */
const stageOf = (job: YtDownloadJournalJob): Stage => {
  // Started before Wave was killed: it has no slot until the queue takes it up again.
  if (job.resumed === true) return "waiting";
  switch (job.phase) {
    case "queued":
      return "waiting";
    case "awaitingPublication":
    case "publishing":
    case "completed":
      return "saving";
    default:
      return "downloading";
  }
};

/** Still on its way: neither failed nor in the Library. */
const onItsWay = (status: YtDownloadStatus | null): status is YtDownloadStatus =>
  status !== null && status.kind !== "failed" && status.kind !== "done";

/**
 * The songs on their way: the ones downloading (or saving) first, then the
 * waiting ones in queue order. The journal lists jobs in the order they were
 * asked for, which is the order its queue starts them in. Each line is in
 * [catalogue]'s language.
 */
export const queuedDownloads = <S extends YtSong>(
  jobs: readonly YtDownloadJournalJob<S>[],
  catalogue: Catalogue = en,
): QueuedDownload<S>[] => {
  const rows = jobs.flatMap((job): QueuedDownload<S>[] => {
    const status = statusOf(job);
    if (!onItsWay(status)) return [];
    return [
      {
        id: job.id,
        song: job.song,
        line: ytDownloadLine(status, catalogue) ?? "",
        waiting: job.phase === "queued",
        cancel:
          status.kind === "saving"
            ? null
            : [job.song, ...(job.aliases ?? [])].map((song) => song.videoId),
      },
    ];
  });
  return [...rows.filter((row) => !row.waiting), ...rows.filter((row) => row.waiting)];
};

/**
 * How many songs on their way are downloading, saving and waiting. Downloading
 * are the ones the queue started, which hold its slots (five, and at most ten
 * with the ones waiting on a peer, a pause or JS's answer); saving the ones
 * whose file is downloaded and that wait their turn to join the Library, one
 * at a time (in a big run they pile up); waiting the ones not started yet.
 */
export interface QueuedDownloadCounts {
  readonly downloading: number;
  readonly saving: number;
  readonly waiting: number;
}

/** How many of [jobs] are on their way (`queuedDownloads`), without listing them. */
export const queuedDownloadCounts = <S extends YtSong>(
  jobs: readonly YtDownloadJournalJob<S>[],
): QueuedDownloadCounts => {
  let downloading = 0;
  let saving = 0;
  let waiting = 0;
  for (const job of jobs) {
    if (!onItsWay(statusOf(job))) continue;
    const stage = stageOf(job);
    if (stage === "waiting") waiting += 1;
    else if (stage === "saving") saving += 1;
    else downloading += 1;
  }
  return { downloading, saving, waiting };
};

/**
 * How many songs are downloading and how many wait ([counts]), as the
 * Downloading section and the Settings row say it ("2 downloading · 5
 * waiting"); null with nothing on its way.
 */
export const queuedDownloadsSummary = (
  { downloading, saving, waiting }: QueuedDownloadCounts,
  catalogue: Catalogue = en,
): string | null => {
  const parts = [
    ...(downloading === 0 ? [] : [catalogue.downloadStatus.downloadingCount(downloading)]),
    ...(saving === 0 ? [] : [catalogue.downloadStatus.savingCount(saving)]),
    ...(waiting === 0 ? [] : [catalogue.downloadStatus.waitingCount(waiting)]),
  ];
  return parts.length === 0 ? null : parts.join(" · ");
};
