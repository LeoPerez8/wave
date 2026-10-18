/**
 * Settings › Downloads: the songs whose download failed, each with why, Retry
 * and a trash button that clears it alone, and Retry All and Clear All above
 * them. The native journal keeps a
 * failure until it's retried or cleared; one the song settled another way (it
 * downloaded under another video, a scan found a missing song's file) leaves
 * the list on its own, and the app has the journal forget it
 * (`settledDownloadFailures`).
 */

import { downloadJobKind } from "./downloadJobKind.ts";
import { counted } from "./listening.ts";
import { foundNoBetterCopy, type QualityDirection } from "./qualityReplacement.ts";
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
  const kind = downloadJobKind(job.id);
  if (kind.kind === "quality") return foundNoBetterCopy(job);
  if (kind.kind === "missing")
    return missingTrackIds !== null && !missingTrackIds.has(kind.trackId);
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
    const kind = downloadJobKind(job.id);
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
          kind.kind === "quality"
            ? { kind: "quality", direction: kind.direction, trackId: kind.trackId }
            : kind.kind === "missing"
              ? { kind: "missingSong", trackId: kind.trackId }
              : { kind: "song", song: job.song },
        clear: videosOf(job),
      },
    ];
  });

/**
 * How many songs `failedDownloads` lists, without building their rows: the
 * Settings row's count.
 */
export const failedDownloadCount = <S extends YtSong>(
  jobs: readonly YtDownloadJournalJob<S>[],
  input: FailedDownloadsInput<S>,
): number => {
  let count = 0;
  for (const job of jobs) if (failureOf(job) !== null && !settled(job, input)) count += 1;
  return count;
};

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

/** Whether [job] failed, its download or its import: cheap, for every journal change. */
const hasFailed = <S extends YtSong>(job: YtDownloadJournalJob<S>): boolean =>
  job.phase === "failed" || job.importFailure !== undefined;

/** Two journal jobs that say the same (the journal is plain data, read afresh). */
const sameJob = <S extends YtSong>(a: YtDownloadJournalJob<S>, b: YtDownloadJournalJob<S>) =>
  a === b || JSON.stringify(a) === JSON.stringify(b);

/**
 * The jobs of [jobs] whose download or import failed, in order: [previous]
 * itself while they're the same jobs saying the same, so what's built from
 * them (`failedDownloads`, the failed rows) is built again only when a
 * failure comes, goes or changes, not on each tick of the songs on their way.
 */
export const failedJobs = <J extends YtDownloadJournalJob>(
  jobs: readonly J[],
  previous: readonly J[] = [],
): readonly J[] => {
  const failed = jobs.filter(hasFailed);
  const same =
    failed.length === previous.length &&
    failed.every((job, index) => {
      const before = previous[index];
      return before !== undefined && sameJob(job, before);
    });
  return same ? previous : failed;
};

/** What Retry asks for, as a key: a replacement's direction and Track too. */
const retryKey = <S extends YtSong>(retry: FailedDownloadRetry<S>): string =>
  retry.kind === "quality"
    ? `quality:${retry.direction}:${retry.trackId}`
    : retry.kind === "missingSong"
      ? `missingSong:${retry.trackId}`
      : `song:${retry.song.videoId}`;

/** What a row shows of [song]: its id, title, artists and cover. */
const songKey = (song: YtSong): string =>
  [song.videoId, song.title, song.artists.join(", "), song.artworkUrl ?? ""].join("\u0000");

/**
 * Whether two failed rows show and do the same (the journal is read afresh on
 * each change, so equal rows are new objects): the same song, line, detail,
 * Retry and Remove. A memoised row renders again only when they don't.
 */
export const sameFailedDownload = <S extends YtSong>(
  a: FailedDownload<S>,
  b: FailedDownload<S>,
): boolean =>
  a === b ||
  (a.id === b.id &&
    a.line === b.line &&
    a.detail === b.detail &&
    a.clear.join() === b.clear.join() &&
    retryKey(a.retry) === retryKey(b.retry) &&
    songKey(a.song) === songKey(b.song));

/**
 * The failed section's top row: how many songs failed, with Retry All, Clear
 * All, and what shows or hides the songs ([expanded]).
 */
export interface FailedHeaderRow {
  readonly kind: "failedHeader";
  readonly key: string;
  readonly line: string;
  readonly expanded: boolean;
}

/**
 * The header of the songs that failed for one reason: the reason and how many
 * ("This song is unavailable on YouTube Music · 640"), with Retry and Remove
 * for all of them ([failed]).
 */
export interface FailedGroupRow<S extends YtSong = YtSong> {
  readonly kind: "failedGroup";
  readonly key: string;
  readonly line: string;
  readonly failed: readonly FailedDownload<S>[];
}

/** A failed song, under its reason's header. */
export interface FailedSongRow<S extends YtSong = YtSong> {
  readonly kind: "failedSong";
  readonly key: string;
  readonly failed: FailedDownload<S>;
}

export type FailedListRow<S extends YtSong = YtSong> =
  FailedHeaderRow | FailedGroupRow<S> | FailedSongRow<S>;

/**
 * [failed] (`failedDownloads`) as rows of Settings › Downloads' one
 * virtualized list, under the songs on their way: the row saying how many
 * failed, then while [expanded] the songs grouped by why they failed (the
 * reason first met first), each group under its header. None while no song
 * has failed.
 */
export const failedDownloadRows = <S extends YtSong>(
  failed: readonly FailedDownload<S>[],
  { expanded }: { readonly expanded: boolean },
): readonly FailedListRow<S>[] => {
  if (failed.length === 0) return [];
  const header: FailedHeaderRow = {
    kind: "failedHeader",
    key: "failed",
    line: `${counted(failed.length, "song")} failed`,
    expanded,
  };
  if (!expanded) return [header];
  const byReason = new Map<string, FailedDownload<S>[]>();
  for (const each of failed) {
    const group = byReason.get(each.line);
    if (group === undefined) byReason.set(each.line, [each]);
    else group.push(each);
  }
  const rows: FailedListRow<S>[] = [header];
  for (const [reason, group] of byReason) {
    rows.push({
      kind: "failedGroup",
      key: `failedGroup:${reason}`,
      line: `${reason} · ${group.length.toLocaleString("en")}`,
      failed: group,
    });
    for (const each of group)
      rows.push({ kind: "failedSong", key: `failed:${each.id}`, failed: each });
  }
  return rows;
};
