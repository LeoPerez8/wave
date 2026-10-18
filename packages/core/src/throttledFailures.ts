/**
 * The songs YouTube's limit on Oct 18 failed for good (docs/spec.md, Downloads, "When YouTube
 * limits downloads"): before Wave told a refusal from a clear answer, every refused lookup
 * failed its job as unavailable at its first attempt, with no try again. Once after the update
 * that tells them apart, the app asks again for those songs, which then follow the pause and
 * try-again rules (`ytThrottle`, the `refused` plan).
 */

import { downloadJobKind } from "./downloadJobKind.ts";
import {
  failedDownloads,
  type FailedDownload,
  type FailedDownloadsInput,
} from "./failedDownloads.ts";
import { counted } from "./listening.ts";
import { qualitySongs, type QualityDirection, type QualityFile } from "./qualityReplacement.ts";
import type { YtSong } from "./ytMusic.ts";
import type { YtDownloadJournalJob } from "./ytDownloads.ts";

/** A journal job with what tells how it failed: its attempts, and YouTube's last refusal. */
export interface ThrottledFailureJob<S extends YtSong = YtSong> extends YtDownloadJournalJob<S> {
  /** The attempts its last try made. */
  readonly attempts?: number;
  /** When YouTube last refused its song (epoch ms): only a job failed under the new rules has one. */
  readonly refusedAt?: number;
}

export interface ThrottledFailuresInput<S extends YtSong> extends FailedDownloadsInput<S> {
  /** The Library's files, to tell a replacement's Track still stands to be replaced. */
  readonly files: readonly QualityFile[];
  /** The Tracks recorded as having no better copy, each way. */
  readonly noBetterCopy: { readonly [D in QualityDirection]: ReadonlySet<number> };
  /** The direction Download in best quality gives replacements now: upgrade while it's on. */
  readonly direction: QualityDirection;
}

/** Failed as unavailable, from YouTube, at a first attempt that no try again followed. */
const refusedOnce = (job: ThrottledFailureJob): boolean =>
  job.phase === "failed" &&
  job.importFailure === undefined &&
  job.reason === "ytUnavailable" &&
  job.source === "youtube" &&
  (job.attempts ?? 0) <= 1 &&
  job.refusedAt === undefined;

/**
 * The failed downloads of [jobs] to ask for again: those that failed as unavailable from
 * YouTube at their first attempt, never tried again, whose song hasn't settled since (downloaded,
 * or a missing song found). A replacement goes again only in the direction Download in best
 * quality gives now, while its Track is still offered for it (removed or replaced since, or
 * recorded as having no better copy, it isn't). Each comes with the Retry Settings › Downloads
 * would ask for.
 */
export const throttledFailures = <S extends YtSong>(
  jobs: readonly ThrottledFailureJob<S>[],
  input: ThrottledFailuresInput<S>,
): FailedDownload<S>[] => {
  const candidates = jobs.filter(refusedOnce);
  if (candidates.length === 0) return [];
  const memory = { noBetterCopy: input.noBetterCopy[input.direction], jobs };
  const offered = new Set(
    qualitySongs(input.direction, input.files, memory).map((file) => file.id),
  );
  return failedDownloads(candidates, input).filter(({ id }) => {
    const kind = downloadJobKind(id);
    return (
      kind.kind !== "quality" || (kind.direction === input.direction && offered.has(kind.trackId))
    );
  });
};

/** The app log's line for the [count] songs `throttledFailures` sent back to the queue. */
export const throttledFailuresLine = (count: number): string =>
  count === 0
    ? "No songs that failed as unavailable while YouTube limited downloads needed to go back to the queue"
    : `${counted(count, "song")} that failed as unavailable while YouTube limited downloads went back to the queue`;
