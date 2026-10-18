/**
 * A star means downloaded (docs/spec.md, "Favorites of songs this phone has
 * no file for"): starring a non-D song (a YT Music song, or a missing song)
 * asks for its download, and unstarring it before the file arrives takes
 * back what only the star asked for. These decide what happens to the
 * song's download; the star itself flips at once either way.
 */

import type { DownloadOrigin } from "./downloadGroups.ts";
import { readStoredSet, writeStoredSet } from "./storedJson.ts";
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
export const readStarDownloads = (stored: string | null): ReadonlySet<string> =>
  readStoredSet(stored, (id): id is string => typeof id === "string");

/**
 * How the downloads only a star asked for change: `starred`, the star queued
 * [queued] (the songs `starredDownload` said `queue` for); `unstarred`, the
 * stars of [ids] came off, their downloads cancelled or kept
 * (`unstarredDownload`); `ownerAsked`, the owner asked for [ids] themselves
 * (Download, an album's, a playlist's, Download All), which takes them from
 * the star, so they carry on whatever happens to the star.
 */
export type StarAskedChange =
  | { readonly kind: "starred"; readonly queued: readonly string[] }
  | { readonly kind: "unstarred"; readonly ids: readonly string[] }
  | { readonly kind: "ownerAsked"; readonly ids: readonly string[] };

/**
 * The downloads only a star asked for ([asked], by job id) after [change];
 * [asked] itself when nothing changes.
 */
export const starAskedAfter = (
  asked: ReadonlySet<string>,
  change: StarAskedChange,
): ReadonlySet<string> => {
  if (change.kind === "starred") {
    if (change.queued.every((id) => asked.has(id))) return asked;
    return new Set([...asked, ...change.queued]);
  }
  if (!change.ids.some((id) => asked.has(id))) return asked;
  const gone = new Set(change.ids);
  return new Set([...asked].filter((id) => !gone.has(id)));
};

/**
 * Whether a YT Music song (by [videoId]) shows starred: its pending favorite,
 * or the Library song's star once the Library has it ([track]). Either, so the
 * star stays lit while the arriving file settles its pending favorite into the
 * Library song's star.
 */
export const ytSongStarred = (
  videoId: string,
  track: { readonly id: number } | null,
  favorites: ReadonlySet<number>,
  pending: ReadonlySet<string>,
): boolean => pending.has(videoId) || (track !== null && favorites.has(track.id));

/** What the stars of missing songs ask of this phone's downloads (`syncedStarDownloads`). */
export interface SyncedStarDownloads {
  /** The missing songs whose downloads their stars ask for, in the Library's order. */
  readonly download: readonly number[];
  /**
   * The songs seen starred and missing before that aren't now: unstarred, on
   * this phone or another, or gone from the Library. Their downloads go as
   * an unstar's do (`unstarredDownload`).
   */
  readonly cancel: readonly number[];
  /** The missing songs whose stars this phone has seen now: the next call's [seen]. */
  readonly seen: ReadonlySet<number>;
}

/**
 * Stars of missing songs, the Wave account's (another phone's, or this one's
 * before a sign-in) as much as this phone's: each missing song with a star
 * downloads. [seen] are the starred missing songs this phone saw before,
 * whose stars have asked already: a download cancelled or cleared since
 * stays so.
 */
export const syncedStarDownloads = (
  {
    starred,
    missing,
  }: { readonly starred: ReadonlySet<number>; readonly missing: readonly number[] },
  seen: ReadonlySet<number>,
): SyncedStarDownloads => {
  const starredMissing = missing.filter((id) => starred.has(id));
  const now = new Set(starredMissing);
  return {
    download: starredMissing.filter((id) => !seen.has(id)),
    cancel: [...seen].filter((id) => !now.has(id)),
    seen: now,
  };
};

/** [ids] as `readStarDownloads` reads them back; null (nothing stored) for none. */
export const writeStarDownloads = (ids: ReadonlySet<string>): string | null => writeStoredSet(ids);

/**
 * The starred missing songs this phone has seen ([seen], `syncedStarDownloads`'s), after
 * missing songs [trackIds] were starred ([on]) or unstarred here. A star set here has asked for
 * its download already, so it counts as seen: should another phone take it off before the file
 * arrives, the next sync takes the download back. An unstar here took its download back
 * itself, so the song is seen no more.
 */
export const starredHere = (
  seen: ReadonlySet<number>,
  trackIds: readonly number[],
  on: boolean,
): ReadonlySet<number> => {
  if (trackIds.every((id) => seen.has(id) === on)) return seen;
  const next = new Set(seen);
  for (const id of trackIds) {
    if (on) next.add(id);
    else next.delete(id);
  }
  return next;
};

/**
 * The starred missing songs this phone has seen (`syncedStarDownloads`'s
 * [seen]), by track id, as the key-value store keeps them: a JSON array, or
 * nothing when there are none. What can't be read counts as none.
 */
export const readSyncedStars = (stored: string | null): ReadonlySet<number> =>
  readStoredSet(stored, (id): id is number => Number.isInteger(id));

/** [ids] as `readSyncedStars` reads them back; null (nothing stored) for none. */
export const writeSyncedStars = (ids: ReadonlySet<number>): string | null => writeStoredSet(ids);
