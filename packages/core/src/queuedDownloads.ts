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
 * Each song on its way's line ([catalogue]'s language), by job id: what a row
 * of the Downloading list follows on its own (#1441), so a progress tick
 * renders that row and leaves the list alone (`sameDownloadingList`).
 */
export const queuedDownloadLines = <S extends YtSong>(
  jobs: readonly YtDownloadJournalJob<S>[],
  catalogue: Catalogue = en,
): ReadonlyMap<string, string> => {
  const lines = new Map<string, string>();
  for (const job of jobs) {
    const status = statusOf(job);
    if (onItsWay(status)) lines.set(job.id, ytDownloadLine(status, catalogue) ?? "");
  }
  return lines;
};

/** Two songs show the same: their fields alike, lists item by item. */
const sameSong = (a: YtSong, b: YtSong): boolean => {
  if (a === b) return true;
  const keys = Object.keys(a) as (keyof YtSong)[];
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => {
      const x = a[key];
      const y = b[key];
      if (Array.isArray(x) && Array.isArray(y))
        return x.length === y.length && x.every((item, index) => Object.is(item, y[index]));
      return Object.is(x, y);
    })
  );
};

const sameIds = (a: readonly string[] | null, b: readonly string[] | null): boolean =>
  a === b ||
  (a !== null && b !== null && a.length === b.length && a.every((id, index) => id === b[index]));

/**
 * Two rows of songs on their way show the same apart from their lines, which
 * rows follow on their own (`queuedDownloadLines`): the same job, song,
 * place in the queue and Cancel. A job fresh from the journal on a progress
 * tick, its song a new object, is still the same row.
 */
export const sameQueuedDownload = <S extends YtSong>(
  a: QueuedDownload<S>,
  b: QueuedDownload<S>,
): boolean =>
  a === b ||
  (a.id === b.id &&
    a.waiting === b.waiting &&
    sameIds(a.cancel, b.cancel) &&
    sameSong(a.song, b.song));

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
