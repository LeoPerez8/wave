/** Downloads as the window sees them (`window.wave.downloads`): the journal's songs and the run. */
import type { MissingSongsDownloadAction, YtSongsDownloadAction } from "@wave/core";

/** What every song's row on the Downloads page shows. */
interface DownloadSong {
  /** Unique among the page's rows, and the same across journal changes. */
  readonly key: string;
  /** The journal's job id: a video id, or `missing:<trackId>` for a missing song. */
  readonly id: string;
  readonly title: string;
  readonly artist: string;
  readonly artworkUrl: string | null;
  /** Where its download is, or why it failed (Core's `ytDownloadLine`). */
  readonly line: string;
  /**
   * The ids Cancel (Remove, for a failed song) hands to `downloads.cancel`; null once the song
   * is saving to the Library, too late to cancel.
   */
  readonly cancel: readonly string[] | null;
}

/** A song downloading or saving now: nothing to drag. */
export interface DownloadingRow extends DownloadSong {
  readonly kind: "downloading";
}

/** A waiting song, under its group's header: it drags among its group's waiting songs only. */
export interface WaitingRow extends DownloadSong {
  readonly kind: "waiting";
  readonly groupKey: string;
  /** Its place among its group's waiting songs, and how many there are. */
  readonly index: number;
  readonly count: number;
}

/**
 * A group's header: the playlist, album, Discover mix, quality run or Favorites its songs were
 * asked from, or Songs. A `header` drags among the other groups with waiting songs; a
 * `startedHeader`'s songs have all started.
 */
export interface DownloadGroupRow {
  readonly kind: "header" | "startedHeader";
  readonly key: string;
  readonly groupKey: string;
  readonly name: string;
  /** "40 of 120 · 2 failed · 78 left" during a run, else "12 songs left". */
  readonly line: string;
  /** How far the group's run has come, 0 to 1; null without one. */
  readonly fraction: number | null;
  /** Its place among the groups that move, and how many there are. */
  readonly index: number;
  readonly count: number;
}

/** The failed section's first row: how many failed, Retry All, Clear All, Show or Hide Songs. */
export interface FailedHeaderRow {
  readonly kind: "failedHeader";
  readonly key: string;
  readonly line: string;
  readonly expanded: boolean;
}

/** The songs that failed for one reason: `downloads.failedReason` retries or removes them all. */
export interface FailedReasonRow {
  readonly kind: "failedGroup";
  readonly key: string;
  readonly reason: string;
  /** The reason and how many: "No source has this song · 640". */
  readonly line: string;
}

export interface FailedSongRow extends DownloadSong {
  readonly kind: "failedSong";
  /** What went wrong, when the line doesn't say what to do about it. */
  readonly detail: string | null;
  readonly cancel: readonly string[];
}

/**
 * A row of the Downloads page (Core's `downloadListRows` and `failedDownloadRows`): the songs
 * downloading now, each group's header over its waiting songs, then the failed section.
 */
export type DownloadRow =
  | DownloadingRow
  | WaitingRow
  | DownloadGroupRow
  | FailedHeaderRow
  | FailedReasonRow
  | FailedSongRow;

/**
 * A waiting song or a group, moved by a drag or by Move Up and Move Down: onto another's place
 * ([to]: a job id of the same group, or a group key) or one place up or down ([step]).
 */
export type DownloadMove = {
  readonly kind: "song" | "group";
  /** The song's job id, or the group's key. */
  readonly from: string;
} & ({ readonly to: string } | { readonly step: -1 | 1 });

export const FAILED_REASON_ACTIONS = ["retry", "remove"] as const;
export type FailedReasonAction = (typeof FAILED_REASON_ACTIONS)[number];

/** The run panel atop the Downloads page (Core's `downloadRunLines`, `downloadRunPanelLine`). */
export interface DownloadRunPanel {
  /** "1,234 of 2,500". */
  readonly count: string;
  /** "12 failed · 1,254 left · About 2 h left", or "… · Paused". */
  readonly line: string;
  /** The bar: the songs finished of all, 0 to 1. */
  readonly fraction: number;
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
  /** The run's panel; null with no run. */
  readonly panel: DownloadRunPanel | null;
  /** "2 downloading · 5 waiting"; null with nothing on its way. */
  readonly summary: string | null;
  /** While YouTube limits downloads: that they are paused and for how many minutes; else null. */
  readonly pauseNotice: string | null;
  /** Changes whenever the page's rows may have: the journal's revision. */
  readonly revision: number;
  /** The songs on their way and the failed ones. */
  readonly rows: number;
  readonly failed: number;
  readonly missing: MissingSongsView;
}

export const MISSING_SONGS_ACTIONS: readonly MissingSongsDownloadAction[] = [
  "downloadAll",
  "retryFailed",
  "cancel",
];

/**
 * A YT Music list whose songs download together, as its page reads them: an album's page by its
 * browse id, or one of today's Discover mixes by its id. Its page's download button and head
 * line are `YtListDownloadView`.
 */
export interface YtSongsList {
  readonly kind: "album" | "discoverMix";
  readonly id: string;
}

/** Where a YT Music list's download stands, as its page head shows it (Core's `ytSongsDownload`). */
export interface YtListDownloadView {
  /**
   * The button: what a click does and what it says (Download, Cancel, Retry Failed), or
   * Downloaded once the Library has every song; null with neither.
   */
  readonly button: {
    readonly action: YtSongsDownloadAction | "downloaded";
    readonly label: string;
  } | null;
  /** The head's progress line ("Downloading · 3 of 10"); null with nothing on its way. */
  readonly line: string | null;
}

export const YT_SONGS_DOWNLOAD_ACTIONS: readonly YtSongsDownloadAction[] = [
  "download",
  "retryFailed",
  "cancel",
];
