/**
 * Settings › Downloads: the songs whose download failed, each with why and
 * Retry, and Retry All and Clear All above them. The native journal keeps a
 * failure until it's retried or cleared; one the song settled another way (it
 * downloaded under another video, a scan found a missing song's file) leaves
 * the list on its own.
 */

import { missingSongTrackId } from "./missingSongDownload.ts";
import type { YtSong } from "./ytMusic.ts";
import {
  ytDownloadLine,
  ytDownloadsFromJournal,
  type YtDownloadFailure,
  type YtDownloadJournalJob,
} from "./ytDownloads.ts";

/** One failed song as its row on the Downloads page shows it. */
export interface FailedDownload<S extends YtSong = YtSong> {
  /** The journal's job. */
  readonly id: string;
  readonly song: S;
  /** Why it failed, as the song's row says it elsewhere. */
  readonly line: string;
  /**
   * What actually went wrong (the journal's `cause`), under a line that
   * doesn't say what to do about it; null otherwise.
   */
  readonly detail: string | null;
  /** What Retry asks for again: the song, or for a missing song its Track. */
  readonly retry: FailedDownloadRetry<S>;
  /**
   * The video ids Clear cancels: every one asked for on the job, since each
   * requester leaves a shared job on its own.
   */
  readonly clear: readonly string[];
}

export type FailedDownloadRetry<S extends YtSong> =
  | { readonly kind: "song"; readonly song: S }
  | { readonly kind: "missingSong"; readonly trackId: number };

export interface FailedDownloadsInput<S extends YtSong> {
  /** Whether the Library has a YT Music song now (`libraryFinder`). */
  readonly inLibrary: (song: S) => boolean;
  /**
   * The Track ids of the Library's missing songs, or null before they're read:
   * a missing song's failure whose Track is no longer missing has settled.
   */
  readonly missingTrackIds: ReadonlySet<number> | null;
}

/** Failures whose line already says what to do: their cause adds nothing. */
const SELF_EXPLAINED: readonly YtDownloadFailure[] = [
  "offline",
  "account",
  "accountRejected",
  "noSource",
  "noFolder",
];

/** A JVM or JS class's package, at the start of each error in a cause chain. */
const PACKAGE = /^(?:[a-z_$][\w$]*\.)+(?=[A-Z])/;

/** [cause] as a line under the failure: each error's class without its package. */
const causeLine = (cause: string): string =>
  cause
    .split(" <- ")
    .map((error) => error.replace(PACKAGE, ""))
    .join(" <- ");

/** Whether [job]'s song came into the Library some other way since it failed. */
const settled = <S extends YtSong>(
  job: YtDownloadJournalJob<S>,
  { inLibrary, missingTrackIds }: FailedDownloadsInput<S>,
): boolean => {
  const trackId = missingSongTrackId(job.id);
  if (trackId !== null) return missingTrackIds !== null && !missingTrackIds.has(trackId);
  return [job.song, ...(job.aliases ?? [])].some(inLibrary);
};

/** The songs whose download failed and haven't settled since, in the order they were asked for. */
export const failedDownloads = <S extends YtSong>(
  jobs: readonly YtDownloadJournalJob<S>[],
  input: FailedDownloadsInput<S>,
): FailedDownload<S>[] =>
  jobs.flatMap((job) => {
    const status = ytDownloadsFromJournal([job]).jobs[0]?.status;
    if (status?.kind !== "failed" || settled(job, input)) return [];
    const trackId = missingSongTrackId(job.id);
    return [
      {
        id: job.id,
        song: job.song,
        line: ytDownloadLine(status) ?? "",
        detail:
          job.cause === undefined || SELF_EXPLAINED.includes(status.reason)
            ? null
            : causeLine(job.cause),
        retry:
          trackId === null ? { kind: "song", song: job.song } : { kind: "missingSong", trackId },
        clear: [job.song, ...(job.aliases ?? [])].map((song) => song.videoId),
      },
    ];
  });
