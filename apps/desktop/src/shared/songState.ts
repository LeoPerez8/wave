import { ytDownloadProgress, type YtDownloadStatus } from "@wave/core";

/** A visible Library song's session state, read in bounded batches. */
export interface SongState {
  readonly id: number;
  /** Where the missing song's download is; null when none was asked for. */
  readonly download: YtDownloadStatus | null;
  /** Its file was asked to play this session and couldn't. */
  readonly failed: boolean;
}

/** What a song row shows over its picture, and how the row reads. */
export type SongRowMark =
  | { readonly kind: "play" }
  /** Its drive isn't connected. */
  | { readonly kind: "unavailable" }
  /** The account has it and this computer has no file: dimmed, a click downloads it. */
  | { readonly kind: "missing" }
  /** A missing song on its way; [progress] is 0 to 1, null before the file's size is known. */
  | { readonly kind: "downloading"; readonly progress: number | null }
  /** It has a file that didn't play. */
  | { readonly kind: "failed" };

/** [row]'s mark, given its [state] when main has answered for it. */
export const songRowMark = (
  row: {
    readonly id: number;
    readonly path: string | null;
    readonly unavailable: boolean;
    readonly videoId?: string | undefined;
  },
  state: SongState | undefined,
): SongRowMark => {
  if (row.unavailable) return { kind: "unavailable" };
  if (row.videoId !== undefined || row.id <= 0) return { kind: "play" };
  if (row.path !== null) return { kind: state?.failed === true ? "failed" : "play" };
  const download = state?.download ?? null;
  switch (download?.kind) {
    case "queued":
      return { kind: "downloading", progress: null };
    case "downloading":
      return { kind: "downloading", progress: ytDownloadProgress(download) };
    case "saving":
      return { kind: "downloading", progress: 1 };
    default:
      return { kind: "missing" };
  }
};
