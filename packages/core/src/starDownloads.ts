/**
 * A star means downloaded (docs/spec.md, "Favorites of songs this phone has
 * no file for"): starring a non-D song (a YT Music song, or a missing song)
 * asks for its download, and unstarring it before the file arrives takes
 * back what only the star asked for. These decide what happens to the
 * song's download; the star itself flips at once either way.
 */

import type { DownloadOrigin } from "./downloadGroups.ts";
import type { YtDownloadStatus } from "./ytDownloads.ts";

/**
 * Where the downloads a star asked for wait in Settings › Downloads ›
 * Downloading: a group of their own, "Favorites".
 */
export const FAVORITES_DOWNLOAD_ORIGIN: DownloadOrigin = {
  kind: "favorites",
  id: "favorites",
  name: "Favorites",
};

/**
 * What starring a non-D song does to its download: `queue` asks for it under
 * Favorites, and only the star has asked; `retry` asks again for a failed
 * one, keeping where it was asked from (someone asked before the star did);
 * `keep` leaves one already on its way as it is, so the song just gets the
 * star.
 */
export type StarredDownload = "queue" | "retry" | "keep";

/** What starring a song whose download is at [status] (null: never asked for) does to it. */
export const starredDownload = (status: YtDownloadStatus | null): StarredDownload => {
  switch (status?.kind) {
    case undefined:
    // Downloaded before, and gone from the Library since: it's non-D again.
    case "done":
      return "queue";
    case "failed":
      return "retry";
    case "queued":
    case "downloading":
    case "saving":
      return "keep";
  }
};

/**
 * What unstarring a non-D song before its file arrives does to its download:
 * `cancel` takes back one only the star asked for ([starAsked]), waiting,
 * downloading or failed; `keep` leaves one the owner asked for separately
 * (Download, an album's, a playlist's), one already saving to the Library
 * (too late to cancel), and nothing on its way.
 */
export type UnstarredDownload = "cancel" | "keep";

/** What unstarring a song whose download is at [status] does to it. */
export const unstarredDownload = (
  status: YtDownloadStatus | null,
  { starAsked }: { readonly starAsked: boolean },
): UnstarredDownload => {
  if (!starAsked) return "keep";
  switch (status?.kind) {
    case "queued":
    case "downloading":
    case "failed":
      return "cancel";
    case undefined:
    case "saving":
    case "done":
      return "keep";
  }
};

/**
 * The downloads only a star asked for, by job id (a YT Music song's video id,
 * a missing song's `missing:<id>`), as the key-value store keeps them on this
 * phone: a JSON array, or nothing when there are none. What can't be read
 * counts as none.
 */
export const readStarDownloads = (stored: string | null): ReadonlySet<string> => {
  if (stored === null) return new Set();
  try {
    const value: unknown = JSON.parse(stored);
    return new Set(
      Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [],
    );
  } catch {
    return new Set();
  }
};

/** [ids] as `readStarDownloads` reads them back; null (nothing stored) for none. */
export const writeStarDownloads = (ids: ReadonlySet<string>): string | null =>
  ids.size === 0 ? null : JSON.stringify([...ids]);
