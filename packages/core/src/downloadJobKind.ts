/**
 * What a download journal job is, by its id: each kind is prepared, reported and imported its own
 * way, so callers switch on this once instead of trying each id format in turn.
 */

import { missingSongTrackId } from "./missingSongDownload.ts";
import { qualityJobOf, type QualityDirection } from "./qualityReplacement.ts";
import { isUnsearchedSongJob } from "./unsearchedDownload.ts";

export type DownloadJobKind =
  /** A quality replacement (`qualityJobId`): replaces Track [trackId]'s file in [direction]. */
  | { readonly kind: "quality"; readonly direction: QualityDirection; readonly trackId: number }
  /** A missing song's download (`missing:<id>`): fills in Track [trackId]. */
  | { readonly kind: "missing"; readonly trackId: number }
  /** An unsearched song's download, named after what Spotify listed (`unsearchedTrackId`). */
  | { readonly kind: "unsearched" }
  /** A YT Music song's download, named after its own video. */
  | { readonly kind: "song" };

/** The kind of download job [jobId] is. */
export const downloadJobKind = (jobId: string): DownloadJobKind => {
  const replacement = qualityJobOf(jobId);
  if (replacement !== null) return { kind: "quality", ...replacement };
  const trackId = missingSongTrackId(jobId);
  if (trackId !== null) return { kind: "missing", trackId };
  return isUnsearchedSongJob(jobId) ? { kind: "unsearched" } : { kind: "song" };
};
