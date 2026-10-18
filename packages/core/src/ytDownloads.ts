/**
 * YT Music downloads as rows and menus show them. The native journal owns the
 * queue (one transfer at a time, in the order asked for; a failed one says why
 * and can be retried, a cancelled one is forgotten); rows read its snapshot
 * through `ytDownloadsFromJournal`.
 */

import type { DownloadSource } from "./downloadSource.ts";
import type { DownloadOrigin } from "./downloadGroups.ts";
import type { YtSong } from "./ytMusic.ts";
import { soulseekSameRecording } from "./soulseekDownload.ts";

/**
 * Why acquisition failed, including account setup and an unavailable recording:
 * `account` is Soulseek with Download in best quality off (or no account),
 * `accountRejected` an account Soulseek turned down (which turns it off),
 * `unreachable` Soulseek's server not answering while the phone is online
 * (`offline` is the phone), `unavailable` no Soulseek copy in 320 kbps,
 * `timedOut` a download that used up its time, `noSource` both YT Music and
 * Download in best quality off, `ytUnavailable` a song YouTube Music won't
 * serve (or serves audio of another length), and `notFound` a missing song
 * YouTube Music's search has no match for (`missingSongVideo`).
 */
export type YtDownloadFailure =
  | "offline"
  | "failed"
  | "timedOut"
  | "noFolder"
  | "storage"
  | "account"
  | "accountRejected"
  | "unreachable"
  | "unavailable"
  | "noSource"
  | "ytUnavailable"
  | "notFound";

export type YtDownloadPhase = "connecting" | "searching" | "queued" | "transferring" | "validating";

export type YtDownloadStatus =
  | { readonly kind: "queued" }
  /** [total] is the file's size in bytes, once known. */
  | {
      readonly kind: "downloading";
      readonly received: number;
      readonly total: number | null;
      readonly phase?: YtDownloadPhase;
    }
  /** Tagging the file and moving it into the Library: too late to cancel. */
  | { readonly kind: "saving" }
  | { readonly kind: "failed"; readonly reason: YtDownloadFailure }
  | { readonly kind: "done"; readonly path: string };

export interface YtDownloadJob<S extends YtSong = YtSong> {
  readonly song: S;
  readonly status: YtDownloadStatus;
  /** Different result ids positively matched to this recording; all lengths stay within tolerance. */
  readonly relatedSongs?: readonly S[];
}

/** Every download of this session, in the order they were (last) asked for. */
export interface YtDownloads<S extends YtSong = YtSong> {
  readonly jobs: readonly YtDownloadJob<S>[];
}

export const YT_DOWNLOADS_NONE: YtDownloads<never> = { jobs: [] };

/**
 * Where a job is in the native download journal (`DurableDownloads`), which
 * owns the queue so it survives the screen going off and process recreation.
 */
export type YtDownloadJournalPhase =
  | "queued"
  | "preparing"
  | "prepared"
  | "transferring"
  | "sourceReady"
  | "tagging"
  | "awaitingPublication"
  | "publishing"
  | "completed"
  | "failed"
  | "cancelled";

/** A job as the native journal's snapshot reports it. */
export interface YtDownloadJournalJob<S extends YtSong = YtSong> {
  readonly id: string;
  readonly song: S;
  /** Other result ids positively matched to the same recording. */
  readonly aliases?: readonly S[];
  readonly phase: YtDownloadJournalPhase;
  /** Where the audio comes from; a job from before YouTube Music downloads is Soulseek's. */
  readonly source?: DownloadSource;
  readonly received?: number;
  readonly total?: number;
  /** The peer's queue position while it keeps us waiting. */
  readonly queuePosition?: number | null;
  readonly reason?: YtDownloadFailure;
  /** The file was published but the Library couldn't import it. */
  readonly importFailure?: YtDownloadFailure;
  /**
   * What last went wrong, as "Class: message" (`downloadFailureCause`, or the
   * native exception): kept through a retry's attempts and cleared when the
   * user retries. It belongs to the failure the job shows: a fallback sets
   * Soulseek's aside, which comes back only with Soulseek's failure. Absent
   * for a failure decided on.
   */
  readonly cause?: string;
  /** The Library imported the file. */
  readonly acknowledged?: boolean;
  readonly saved?: { readonly path: string };
  /**
   * The playlist, album or Discover mix whose Download asked for the job
   * (`downloadingList` groups by it); null or absent for a song asked for on
   * its own, and for jobs queued before downloads remembered it.
   */
  readonly origin?: DownloadOrigin | null;
}

const downloading = (phase: YtDownloadPhase): YtDownloadStatus => ({
  kind: "downloading",
  received: 0,
  total: null,
  phase,
});

const journalStatus = (job: YtDownloadJournalJob): YtDownloadStatus => {
  if (job.importFailure !== undefined) return { kind: "failed", reason: job.importFailure };
  // YouTube Music has no recording to find or peer to reach: the job waits until the audio flows.
  const youtube = job.source === "youtube";
  switch (job.phase) {
    case "queued":
      return { kind: "queued" };
    case "preparing":
      return downloading(youtube ? "queued" : "searching");
    case "prepared":
      return downloading(youtube ? "queued" : "connecting");
    case "transferring":
      return job.queuePosition !== undefined && job.queuePosition !== null
        ? downloading("queued")
        : {
            kind: "downloading",
            received: job.received ?? 0,
            total: job.total !== undefined && job.total > 0 ? job.total : null,
            phase: "transferring",
          };
    case "sourceReady":
      return downloading("validating");
    case "tagging":
    case "awaitingPublication":
    case "publishing":
      return { kind: "saving" };
    case "completed":
      return job.acknowledged === true && job.saved !== undefined
        ? { kind: "done", path: job.saved.path }
        : { kind: "saving" };
    case "failed":
    case "cancelled":
      return { kind: "failed", reason: job.reason ?? "failed" };
  }
};

/** The journal's jobs as rows and menus show them; a cancelled job is forgotten. */
export const ytDownloadsFromJournal = <S extends YtSong>(
  jobs: readonly YtDownloadJournalJob<S>[],
): YtDownloads<S> => ({
  jobs: jobs
    .filter((job) => job.phase !== "cancelled")
    .map((job) => ({
      song: job.song,
      status: journalStatus(job),
      ...(job.aliases === undefined || job.aliases.length === 0
        ? {}
        : { relatedSongs: job.aliases }),
    })),
});

/**
 * The unfinished job that [song] (another result id) should share: every song
 * already on it is positively the same recording, so lengths can't drift in a
 * chain. Null when [song] needs a job of its own.
 */
export const ytDownloadSharedJob = <S extends YtSong>(
  jobs: readonly YtDownloadJournalJob<S>[],
  song: S,
): string | null =>
  jobs.find(
    (job) =>
      job.phase !== "failed" &&
      job.phase !== "cancelled" &&
      job.acknowledged !== true &&
      job.importFailure === undefined &&
      [job.song, ...(job.aliases ?? [])].every((other) => soulseekSameRecording(other, song)),
  )?.id ?? null;

/** Where [videoId]'s download is, or null when it was never asked for (or was cancelled). */
export const ytDownloadStatus = (state: YtDownloads, videoId: string): YtDownloadStatus | null =>
  state.jobs.find(
    (job) =>
      job.song.videoId === videoId || job.relatedSongs?.some((song) => song.videoId === videoId),
  )?.status ?? null;

/**
 * `ytDownloadStatus` for any number of video ids, the jobs read once: a long
 * list's statuses aren't a search each.
 */
export const ytDownloadStatuses = (
  state: YtDownloads,
): ((videoId: string) => YtDownloadStatus | null) => {
  const byId = new Map<string, YtDownloadStatus>();
  for (const job of state.jobs) {
    for (const { videoId } of [job.song, ...(job.relatedSongs ?? [])]) {
      if (!byId.has(videoId)) byId.set(videoId, job.status);
    }
  }
  return (videoId) => byId.get(videoId) ?? null;
};

export type YtDownloadAction = "download" | "cancelDownload" | "retryDownload";

export const YT_DOWNLOAD_ACTION_LABELS: { readonly [A in YtDownloadAction]: string } = {
  download: "Download",
  cancelDownload: "Cancel Download",
  retryDownload: "Retry Download",
};

/**
 * The download entries a YT Music song's menu offers, given its download's
 * [status]. A song downloaded this session offers Download again only once
 * it's no longer in the Library ([inLibrary], from `libraryFinder`). A failed
 * one offers Retry alone: Settings › Downloads clears failures.
 */
export const ytDownloadActions = (
  status: YtDownloadStatus | null,
  { inLibrary }: { readonly inLibrary: boolean },
): YtDownloadAction[] => {
  switch (status?.kind) {
    case undefined:
      return ["download"];
    case "queued":
    case "downloading":
      return ["cancelDownload"];
    case "failed":
      return ["retryDownload"];
    case "saving":
      return [];
    case "done":
      return inLibrary ? [] : ["download"];
  }
};

const FAILURE_LINES: { readonly [F in YtDownloadFailure]: string } = {
  offline: "Download failed: offline",
  failed: "Download failed",
  timedOut: "Download failed",
  noFolder: "Download failed: no music folder",
  storage: "Download failed: couldn't save the file",
  account: "Turn on Download in best quality in Settings",
  // A rejected account is forgotten and the switch turned off; turning it on makes a new one.
  accountRejected: "Turn on Download in best quality in Settings",
  unreachable: "Download failed: Soulseek can't be reached",
  unavailable: "This recording is unavailable in 320 kbps",
  noSource: "Turn on YT Music or Download in best quality in Settings",
  ytUnavailable: "This song is unavailable on YouTube Music",
  notFound: "Not found online",
};

/** The fraction of the file that has arrived, or null when there's no size to measure against. */
export const ytDownloadProgress = (status: YtDownloadStatus | null): number | null =>
  status?.kind === "downloading" && status.total !== null && status.total > 0
    ? Math.min(1, status.received / status.total)
    : null;

/** What a downloading song's row says under its title instead of its artists; null without a download. */
export const ytDownloadLine = (status: YtDownloadStatus | null): string | null => {
  switch (status?.kind) {
    case undefined:
      return null;
    case "queued":
      return "Waiting to download";
    case "downloading": {
      if (status.phase === "connecting") return "Connecting";
      if (status.phase === "searching") return "Finding this recording";
      if (status.phase === "queued") return "Waiting to download";
      if (status.phase === "validating") return "Checking the download";
      const progress = ytDownloadProgress(status);
      return progress === null ? "Downloading" : `Downloading · ${Math.floor(progress * 100)}%`;
    }
    case "saving":
      return "Saving to the Library";
    case "failed":
      return FAILURE_LINES[status.reason];
    case "done":
      return "In the Library";
  }
};
