import { ytDownloadProgress, type YtDownloadStatus } from "./ytDownloads.ts";

/**
 * What Now Playing's Download button shows for the song playing: Download,
 * waiting, a progress ring ([fraction] of the file received), or failed (a
 * tap retries). None for a song the Library has a file for.
 */
export type NowPlayingDownload =
  | { readonly kind: "download" }
  | { readonly kind: "waiting" }
  | { readonly kind: "progress"; readonly fraction: number }
  | { readonly kind: "failed" };

/**
 * Now Playing's Download button for the song playing, given its download's
 * [status] and whether the Library has a file for it ([hasFile]).
 */
export const nowPlayingDownload = (
  status: YtDownloadStatus | null,
  { hasFile }: { readonly hasFile: boolean },
): NowPlayingDownload | null => {
  if (hasFile) return null;
  switch (status?.kind) {
    case undefined:
      return { kind: "download" };
    case "queued":
      return { kind: "waiting" };
    case "downloading": {
      const fraction = ytDownloadProgress(status);
      return fraction === null ? { kind: "waiting" } : { kind: "progress", fraction };
    }
    case "saving":
      return { kind: "progress", fraction: 1 };
    case "failed":
      return { kind: "failed" };
    // In the Library, or about to be once it's read again: gone for good.
    case "done":
      return null;
  }
};
