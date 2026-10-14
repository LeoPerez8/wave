/**
 * Downloading a whole YT Music album (docs/spec.md, "YT Music › Downloads"):
 * which of its songs join the download queue, where the album's download
 * stands and what its menu and page offer. Built from the album's songs, the
 * Library matches (`libraryFinder`) and the native download journal, like the
 * single-song `ytDownload*` functions. Each song still goes through the
 * single-song pipeline.
 */

import type { YtSong } from "./ytMusic.ts";
import {
  ytDownloadSharedJob,
  ytDownloadStatus,
  ytDownloadsFromJournal,
  type YtDownloadJournalJob,
  type YtDownloadStatus,
} from "./ytDownloads.ts";

/** Already on its way: queued, downloading or being saved. */
const onItsWay = (status: YtDownloadStatus | null): boolean =>
  status?.kind === "queued" || status?.kind === "downloading" || status?.kind === "saving";

export type YtAlbumDownloadAction = "downloadAlbum" | "retryFailed" | "cancelAlbumDownload";

/** What each album entry says in the album's long-press menu. */
export const YT_ALBUM_DOWNLOAD_ACTION_LABELS: { readonly [A in YtAlbumDownloadAction]: string } = {
  downloadAlbum: "Download Album",
  retryFailed: "Retry Failed",
  cancelAlbumDownload: "Cancel Album Download",
};

/** The same entries as the album page's button beside Play and Shuffle, where room is short. */
const BUTTON_LABELS: { readonly [A in YtAlbumDownloadAction]: string } = {
  downloadAlbum: "Download",
  retryFailed: "Retry Failed",
  cancelAlbumDownload: "Cancel",
};

/** A song Download Album adds to the queue, and the job it shares (null for a job of its own). */
export interface YtAlbumDownloadRequest<S extends YtSong = YtSong> {
  readonly song: S;
  readonly sharedJob: string | null;
}

/** Where an album's download stands, and what acting on it does. */
export interface YtAlbumDownload<S extends YtSong = YtSong> {
  /** The album-level entries its menu offers, in order; its page offers the first. */
  readonly actions: readonly YtAlbumDownloadAction[];
  /** The album page head's progress line ("Downloading · 3 of 10"); null with nothing on its way. */
  readonly line: string | null;
  /** What Download Album adds to the queue, in album order. */
  readonly toDownload: readonly YtAlbumDownloadRequest<S>[];
  /** What Retry Failed asks for again, in album order: songs whose download failed. */
  readonly toRetry: readonly S[];
  /** The video ids Cancel Album Download cancels: songs queued or downloading, not yet saving. */
  readonly toCancel: readonly string[];
}

const cancellable = (status: YtDownloadStatus | null): boolean =>
  status?.kind === "queued" || status?.kind === "downloading";

export const ytAlbumDownload = <S extends YtSong>(
  songs: readonly S[],
  {
    inLibrary,
    jobs,
  }: {
    readonly inLibrary: (song: S) => boolean;
    readonly jobs: readonly YtDownloadJournalJob<S>[];
  },
): YtAlbumDownload<S> => {
  const downloads = ytDownloadsFromJournal(jobs);
  const statuses = songs.map((song) => ytDownloadStatus(downloads, song.videoId));
  // Each song queued here becomes a job of its own (the journal names it after its video id),
  // which a later song on the album that is the same recording shares.
  const ahead: YtDownloadJournalJob<S>[] = [...jobs];
  const toDownload: YtAlbumDownloadRequest<S>[] = [];
  for (const [index, song] of songs.entries()) {
    const status = statuses[index] ?? null;
    if (inLibrary(song) || onItsWay(status) || status?.kind === "failed") continue;
    const sharedJob = ytDownloadSharedJob(ahead, song);
    toDownload.push({ song, sharedJob });
    if (sharedJob === null) ahead.push({ id: song.videoId, song, phase: "queued" });
  }
  const toCancel = songs
    .filter((_, index) => cancellable(statuses[index] ?? null))
    .map((song) => song.videoId);
  const toRetry = songs.filter(
    (song, index) => statuses[index]?.kind === "failed" && !inLibrary(song),
  );
  // The album's batch: its songs downloaded or asked for this session.
  const batch = statuses.filter((status) => status !== null);
  const saved = batch.filter((status) => status.kind === "done").length;
  const downloading = batch.some(onItsWay);
  const actions: YtAlbumDownloadAction[] = [];
  if (toDownload.length > 0) actions.push("downloadAlbum");
  // Failures are retried together once the batch has ended; each keeps its own Retry meanwhile.
  if (toRetry.length > 0 && !downloading) actions.push("retryFailed");
  if (toCancel.length > 0) actions.push("cancelAlbumDownload");
  return {
    actions,
    line: downloading ? `Downloading · ${saved} of ${batch.length}` : null,
    toDownload,
    toRetry,
    toCancel,
  };
};

/** The album page's download button: the album's first entry, or null when it offers none. */
export const ytAlbumDownloadButton = (
  view: YtAlbumDownload,
): { readonly action: YtAlbumDownloadAction; readonly label: string } | null => {
  const action = view.actions[0];
  return action === undefined ? null : { action, label: BUTTON_LABELS[action] };
};
