/**
 * Settings › Downloads: the songs whose download failed, each with why, Retry
 * and a trash button that clears it alone, and Retry All and Clear All above
 * them. The native journal keeps a
 * failure until it's retried or cleared; one the song settled another way (it
 * downloaded under another video, a scan found a missing song's file) leaves
 * the list on its own, and the app has the journal forget it
 * (`settledDownloadFailures`).
 */

import { missingSongTrackId } from "./missingSongDownload.ts";
import { foundNoBetterCopy, qualityJobOf, type QualityDirection } from "./qualityReplacement.ts";
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
   * What actually went wrong (the journal's `cause`, in its errors' own
   * messages), under a line that doesn't say what to do about it; null
   * otherwise.
   */
  readonly detail: string | null;
  /**
   * What Retry asks for again: the song, for a missing song its Track, and
   * for a replacement its Track's replacement.
   */
  readonly retry: FailedDownloadRetry<S>;
  /**
   * The video ids Clear cancels: every one asked for on the job, since each
   * requester leaves a shared job on its own.
   */
  readonly clear: readonly string[];
}

export type FailedDownloadRetry<S extends YtSong> =
  | { readonly kind: "song"; readonly song: S }
  | { readonly kind: "missingSong"; readonly trackId: number }
  | { readonly kind: "quality"; readonly direction: QualityDirection; readonly trackId: number };

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

/**
 * The class (and code) an error in a cause chain starts with: a JVM or JS
 * class, with or without its package, or the bare name a release build
 * shortened it to (R8 turns `SoulseekException` into `bn5`).
 */
const CLASS = /^(?:[A-Za-z_$][\w$]*\.)*([A-Za-z_$][\w$]*)(?: \[[^\]]*\])?/;

/**
 * One error of a cause chain in words: its message without the classes in
 * front of it (an error wrapping another names it there too). One without a
 * message is its class, unless a release build renamed it into nothing a
 * person can read.
 */
const errorLine = (error: string): string | null => {
  const named = CLASS.exec(error);
  if (named?.[0] === error) return /^[A-Z]/.test(named[1] ?? "") ? (named[1] ?? null) : null;
  let message = error;
  for (let head = CLASS.exec(message); head !== null; head = CLASS.exec(message)) {
    if (!message.startsWith(": ", head[0].length)) break;
    message = message.slice(head[0].length + 2);
  }
  return message;
};

/** [cause] as a line under the failure, or null when none of it is in words. */
const causeLine = (cause: string): string | null => {
  const lines = cause
    .split(" <- ")
    .map(errorLine)
    .filter((line): line is string => line !== null && line.length > 0)
    .filter((line, index, all) => line !== all[index - 1]);
  return lines.length === 0 ? null : lines.join(" <- ");
};

/**
 * Whether [job]'s song came into the Library some other way since it failed.
 * A replacement's song is in the Library all along: it settles only when no
 * better copy was found, which keeps its file and isn't a failure.
 */
const settled = <S extends YtSong>(
  job: YtDownloadJournalJob<S>,
  { inLibrary, missingTrackIds }: FailedDownloadsInput<S>,
): boolean => {
  if (qualityJobOf(job.id) !== null) return foundNoBetterCopy(job);
  const trackId = missingSongTrackId(job.id);
  if (trackId !== null) return missingTrackIds !== null && !missingTrackIds.has(trackId);
  return [job.song, ...(job.aliases ?? [])].some(inLibrary);
};

/** [job]'s failure, or null while it hasn't failed. */
const failureOf = <S extends YtSong>(job: YtDownloadJournalJob<S>) => {
  const status = ytDownloadsFromJournal([job]).jobs[0]?.status;
  return status?.kind === "failed" ? status : null;
};

/** Every video asked for on [job]: cancelling each lets the journal end a shared job. */
const videosOf = <S extends YtSong>(job: YtDownloadJournalJob<S>): string[] =>
  [job.song, ...(job.aliases ?? [])].map((song) => song.videoId);

/** The songs whose download failed and haven't settled since, in the order they were asked for. */
export const failedDownloads = <S extends YtSong>(
  jobs: readonly YtDownloadJournalJob<S>[],
  input: FailedDownloadsInput<S>,
): FailedDownload<S>[] =>
  jobs.flatMap((job) => {
    const status = failureOf(job);
    if (status === null || settled(job, input)) return [];
    const trackId = missingSongTrackId(job.id);
    const replacement = qualityJobOf(job.id);
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
          replacement !== null
            ? { kind: "quality", ...replacement }
            : trackId === null
              ? { kind: "song", song: job.song }
              : { kind: "missingSong", trackId },
        clear: videosOf(job),
      },
    ];
  });

/**
 * The videos to cancel so the journal forgets the failures that settled
 * another way: the ones `failedDownloads` no longer lists, which the journal
 * would otherwise keep (and rewrite on every change) for good.
 */
export const settledDownloadFailures = <S extends YtSong>(
  jobs: readonly YtDownloadJournalJob<S>[],
  input: FailedDownloadsInput<S>,
): string[] =>
  jobs.flatMap((job) => (failureOf(job) !== null && settled(job, input) ? videosOf(job) : []));
