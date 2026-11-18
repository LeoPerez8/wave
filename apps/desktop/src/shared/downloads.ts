/** Downloads as the window sees them (`window.wave.downloads`): the journal's songs and the run. */
import type { MissingSongsDownloadAction, YtDownloadStatus } from "@wave/core";

/** A song on the Downloads page: on its way, or failed. */
export interface DownloadRow {
  /** The journal's job id: a video id, or `missing:<trackId>` for a missing song. */
  readonly id: string;
  readonly title: string;
  readonly artist: string;
  readonly album: string;
  readonly artworkUrl: string | null;
  /** Its line comes from Core's `ytDownloadLine`. */
  readonly status: YtDownloadStatus;
}

/** How many songs of the run are done, failed and left (Core's `downloadRunProgress`). */
export interface DownloadRunCounts {
  readonly done: number;
  readonly failed: number;
  readonly left: number;
  readonly total: number;
}

/** A page whose missing songs download together: an album, artist, genre or playlist. */
export interface MissingSongsList {
  readonly kind: "album" | "artist" | "genre" | "playlist";
  readonly id: number;
}

export const MISSING_SONGS_LISTS: readonly MissingSongsList["kind"][] = [
  "album",
  "artist",
  "genre",
  "playlist",
];

/** Where downloading missing songs stands (Core's `missingSongsDownload`), all or one list's. */
export interface MissingSongsView {
  /** The songs still missing. */
  readonly count: number;
  /** "N songs aren't on this computer", or "Downloading · N of M"; null with none. */
  readonly line: string | null;
  readonly actions: readonly MissingSongsDownloadAction[];
  /** Once nothing is on its way: how many songs no source had, as a line. */
  readonly notFound: string | null;
}

export interface DownloadsView {
  /** Latest accepted request, for the window's start notice; repeated reads keep its id. */
  readonly notice: { readonly id: number; readonly count: number } | null;
  /** Downloads pause while the computer is offline, and go on once it's back. */
  readonly online: boolean;
  /** How far the run has come, 0 to 1 (the sidebar's percentage); null with no run. */
  readonly progress: number | null;
  readonly run: DownloadRunCounts | null;
  /** The page's rows (`downloads.rows`). */
  readonly rows: number;
  readonly failed: number;
  readonly missing: MissingSongsView;
}

export const MISSING_SONGS_ACTIONS: readonly MissingSongsDownloadAction[] = [
  "downloadAll",
  "retryFailed",
  "cancel",
];
