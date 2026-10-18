/**
 * Settings › Downloads: the songs on their way, above the failed ones, each
 * with the progress line its row shows elsewhere and Cancel. The native
 * journal's queue downloads up to five songs at once, in the order they were
 * asked for; a song leaves this list for the failed one when it fails, and
 * for good once it's in the Library.
 */

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

/** Still on its way: neither failed nor in the Library. */
const onItsWay = (status: YtDownloadStatus | null): status is YtDownloadStatus =>
  status !== null && status.kind !== "failed" && status.kind !== "done";

/**
 * The songs on their way: the ones downloading (or saving) first, then the
 * waiting ones in queue order. The journal lists jobs in the order they were
 * asked for, which is the order its queue starts them in.
 */
export const queuedDownloads = <S extends YtSong>(
  jobs: readonly YtDownloadJournalJob<S>[],
): QueuedDownload<S>[] => {
  const rows = jobs.flatMap((job): QueuedDownload<S>[] => {
    const status = statusOf(job);
    if (!onItsWay(status)) return [];
    return [
      {
        id: job.id,
        song: job.song,
        line: ytDownloadLine(status) ?? "",
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

/** How many songs on their way are downloading (or saving) and how many wait. */
export interface QueuedDownloadCounts {
  readonly downloading: number;
  readonly waiting: number;
}

/** How many of [jobs] are on their way (`queuedDownloads`), without listing them. */
export const queuedDownloadCounts = <S extends YtSong>(
  jobs: readonly YtDownloadJournalJob<S>[],
): QueuedDownloadCounts => {
  let downloading = 0;
  let waiting = 0;
  for (const job of jobs) {
    if (!onItsWay(statusOf(job))) continue;
    if (job.phase === "queued") waiting += 1;
    else downloading += 1;
  }
  return { downloading, waiting };
};

/**
 * How many songs are downloading and how many wait ([counts]), as the
 * Downloading section and the Settings row say it ("2 downloading · 5
 * waiting"); null with nothing on its way.
 */
export const queuedDownloadsSummary = ({
  downloading,
  waiting,
}: QueuedDownloadCounts): string | null => {
  const parts = [
    ...(downloading === 0 ? [] : [`${downloading.toLocaleString("en")} downloading`]),
    ...(waiting === 0 ? [] : [`${waiting.toLocaleString("en")} waiting`]),
  ];
  return parts.length === 0 ? null : parts.join(" · ");
};
