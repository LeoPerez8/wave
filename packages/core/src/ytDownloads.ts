/**
 * The queue of YT Music downloads: songs wait their turn and download one at
 * a time; a failed one says why and can be retried, a cancelled one is
 * forgotten. The app runs what `ytDownloadsToStart` says and reports back with
 * events; rows and menus read a song's status from here.
 */

import type { YtSong } from "./ytMusic.ts";
import { soulseekSameRecording } from "./soulseekDownload.ts";

/**
 * Why acquisition failed, including account setup and an unavailable recording.
 */
export type YtDownloadFailure =
  | "offline"
  | "failed"
  | "noFolder"
  | "storage"
  | "account"
  | "unavailable";

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

export type YtDownloadEvent<S extends YtSong = YtSong> =
  /** Download (or Retry Download) on [song]. */
  | { readonly type: "requested"; readonly song: S }
  | { readonly type: "started"; readonly videoId: string }
  | { readonly type: "phase"; readonly videoId: string; readonly phase: YtDownloadPhase }
  | {
      readonly type: "progress";
      readonly videoId: string;
      readonly received: number;
      readonly total: number | null;
    }
  | { readonly type: "saving"; readonly videoId: string }
  | { readonly type: "finished"; readonly videoId: string; readonly path: string }
  | { readonly type: "failed"; readonly videoId: string; readonly reason: YtDownloadFailure }
  | { readonly type: "cancelled"; readonly videoId: string };

export const YT_DOWNLOADS_NONE: YtDownloads<never> = { jobs: [] };

/** One transfer at a time keeps progress and storage work predictable. */
const AT_ONCE = 1;

const isActive = (status: YtDownloadStatus): boolean =>
  status.kind === "downloading" || status.kind === "saving";

/** Whether [status] may become [next]; anything else is stale news and ignored. */
const ACCEPTS: { readonly [K in YtDownloadEvent["type"]]: readonly YtDownloadStatus["kind"][] } = {
  // Retry Download, or Download again once the file has left the Library.
  requested: ["failed", "done"],
  started: ["queued"],
  phase: ["downloading"],
  progress: ["downloading"],
  saving: ["downloading"],
  finished: ["downloading", "saving"],
  failed: ["queued", "downloading", "saving"],
  cancelled: ["queued", "downloading", "failed"],
};

export const stepYtDownloads = <S extends YtSong>(
  state: YtDownloads<S>,
  event: YtDownloadEvent<S>,
): YtDownloads<S> => {
  const videoId = event.type === "requested" ? event.song.videoId : event.videoId;
  const index = state.jobs.findIndex(
    (job) =>
      job.song.videoId === videoId || job.relatedSongs?.some((song) => song.videoId === videoId),
  );
  const job = state.jobs[index];
  if (job === undefined) {
    if (event.type === "requested") {
      const duplicate = state.jobs.findIndex(
        (other) =>
          (other.status.kind === "queued" || isActive(other.status)) &&
          [other.song, ...(other.relatedSongs ?? [])].every((song) =>
            soulseekSameRecording(song, event.song),
          ),
      );
      if (duplicate >= 0)
        return {
          jobs: state.jobs.map((other, i) =>
            i === duplicate
              ? { ...other, relatedSongs: [...(other.relatedSongs ?? []), event.song] }
              : other,
          ),
        };
    }
    return event.type === "requested"
      ? { jobs: [...state.jobs, { song: event.song, status: { kind: "queued" } }] }
      : state;
  }
  if (!ACCEPTS[event.type].includes(job.status.kind)) return state;
  const others = state.jobs.filter((_, i) => i !== index);
  const replace = (status: YtDownloadStatus): YtDownloads<S> => ({
    jobs: state.jobs.map((other, i) => (i === index ? { ...other, status } : other)),
  });
  switch (event.type) {
    case "requested":
      // A retry (or a download again) waits behind what's already queued.
      return {
        jobs: [
          ...others,
          {
            ...job,
            song: event.song.videoId === job.song.videoId ? event.song : job.song,
            status: { kind: "queued" },
          },
        ],
      };
    case "started":
      return replace({ kind: "downloading", received: 0, total: null });
    case "progress":
      return replace({ kind: "downloading", received: event.received, total: event.total });
    case "phase":
      return replace({ kind: "downloading", received: 0, total: null, phase: event.phase });
    case "saving":
      return replace({ kind: "saving" });
    case "finished":
      return replace({ kind: "done", path: event.path });
    case "failed":
      return replace({ kind: "failed", reason: event.reason });
    case "cancelled":
      return { jobs: others };
  }
};

/** The songs to start now (each then reported `started`): the first queued, while nothing downloads. */
export const ytDownloadsToStart = <S extends YtSong>(state: YtDownloads<S>): S[] => {
  const free = AT_ONCE - state.jobs.filter((job) => isActive(job.status)).length;
  if (free <= 0) return [];
  return state.jobs
    .filter((job) => job.status.kind === "queued")
    .slice(0, free)
    .map((job) => job.song);
};

/** Where [videoId]'s download is, or null when it was never asked for (or was cancelled). */
export const ytDownloadStatus = (state: YtDownloads, videoId: string): YtDownloadStatus | null =>
  state.jobs.find(
    (job) =>
      job.song.videoId === videoId || job.relatedSongs?.some((song) => song.videoId === videoId),
  )?.status ?? null;

export type YtDownloadAction = "download" | "cancelDownload" | "retryDownload";

export const YT_DOWNLOAD_ACTION_LABELS: { readonly [A in YtDownloadAction]: string } = {
  download: "Download",
  cancelDownload: "Cancel Download",
  retryDownload: "Retry Download",
};

/**
 * The download entries a YT Music song's menu offers, given its download's
 * [status]. A song downloaded this session offers Download again only once
 * it's no longer in the Library ([inLibrary], from `libraryFinder`).
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
      return ["retryDownload", "cancelDownload"];
    case "saving":
      return [];
    case "done":
      return inLibrary ? [] : ["download"];
  }
};

const FAILURE_LINES: { readonly [F in YtDownloadFailure]: string } = {
  offline: "Download failed: offline",
  failed: "Download failed",
  noFolder: "Download failed: no music folder",
  storage: "Download failed: couldn't save the file",
  account: "Connect a free Soulseek account in Settings",
  unavailable: "This recording is unavailable in 320 kbps",
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
