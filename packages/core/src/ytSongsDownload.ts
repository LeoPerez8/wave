/**
 * Downloading a list of YT Music songs in one go (docs/spec.md, "YT Music ›
 * Downloads"): which of them join the download queue, where the list's
 * download stands and what its menu and page offer. Built from the list's
 * songs, the Library matches (`libraryFinder`) and the native download
 * journal, like the single-song `ytDownload*` functions. Each song still goes
 * through the single-song pipeline. A YT Music album (`ytAlbumDownload`) is
 * one such list.
 */

import type { MixedSong } from "./ytDiscover.ts";
import type { YtSong } from "./ytMusic.ts";
import {
  ytDownloadSharedJob,
  ytDownloadStatus,
  ytDownloadsFromJournal,
  type YtDownloadJournalJob,
  type YtDownloadStatus,
  type YtDownloads,
} from "./ytDownloads.ts";

/** Already on its way: queued, downloading or being saved. */
const onItsWay = (status: YtDownloadStatus | null): boolean =>
  status?.kind === "queued" || status?.kind === "downloading" || status?.kind === "saving";

/** What a list's download offers: Download, Retry Failed, Cancel. */
export type YtSongsDownloadAction = "download" | "retryFailed" | "cancel";

export type YtAlbumDownloadAction = "downloadAlbum" | "retryFailed" | "cancelAlbumDownload";

/** What each album entry says in the album's long-press menu. */
export const YT_ALBUM_DOWNLOAD_ACTION_LABELS: { readonly [A in YtAlbumDownloadAction]: string } = {
  downloadAlbum: "Download Album",
  retryFailed: "Retry Failed",
  cancelAlbumDownload: "Cancel Album Download",
};

/** The same entries as the page's button beside Play and Shuffle, where room is short. */
const BUTTON_LABELS: { readonly [A in YtSongsDownloadAction]: string } = {
  download: "Download",
  retryFailed: "Retry Failed",
  cancel: "Cancel",
};

/** A song Download or Retry Failed adds to the queue, and the job it shares (null for a job of its own). */
export interface YtSongsDownloadRequest<S extends YtSong = YtSong> {
  readonly song: S;
  readonly sharedJob: string | null;
}

export type YtAlbumDownloadRequest<S extends YtSong = YtSong> = YtSongsDownloadRequest<S>;

/** Where a list's download stands, and what acting on it does; [A] names its entries. */
export interface YtSongsDownload<
  S extends YtSong = YtSong,
  A extends string = YtSongsDownloadAction,
> {
  /** The list-level entries its menu offers, in order; its page offers the first. */
  readonly actions: readonly A[];
  /** The page head's progress line ("Downloading · 3 of 10"); null with nothing on its way. */
  readonly line: string | null;
  /** What Download adds to the queue, in list order. */
  readonly toDownload: readonly YtSongsDownloadRequest<S>[];
  /** What Retry Failed asks for again, in list order: songs whose download failed. */
  readonly toRetry: readonly YtSongsDownloadRequest<S>[];
  /** The video ids Cancel cancels: songs queued or downloading, not yet saving. */
  readonly toCancel: readonly string[];
}

/** Where an album's download stands, and what acting on it does. */
export type YtAlbumDownload<S extends YtSong = YtSong> = YtSongsDownload<S, YtAlbumDownloadAction>;

const cancellable = (status: YtDownloadStatus | null): boolean =>
  status?.kind === "queued" || status?.kind === "downloading";

/**
 * [songs] as they join the queue, in order, each sharing the unfinished job of
 * the same recording (`ytDownloadSharedJob`). Each song queued becomes a job of
 * its own (the journal names it after its video id), which a later song that is
 * the same recording shares.
 */
const requests = <S extends YtSong>(
  songs: readonly S[],
  jobs: readonly YtDownloadJournalJob<S>[],
): YtSongsDownloadRequest<S>[] => {
  const ahead: YtDownloadJournalJob<S>[] = [...jobs];
  return songs.map((song) => {
    const sharedJob = ytDownloadSharedJob(ahead, song);
    if (sharedJob === null) ahead.push({ id: song.videoId, song, phase: "queued" });
    return { song, sharedJob };
  });
};

interface SongsDownloadInput<S extends YtSong> {
  /** Whether the Library already has a song (`libraryFinder`). */
  readonly inLibrary: (song: S) => boolean;
  /** The download journal's snapshot. */
  readonly jobs: readonly YtDownloadJournalJob<S>[];
}

/**
 * Where downloading [songs] stands. [landed] counts the list's songs saved
 * this session that it no longer holds as YT Music songs (a playlist's entry
 * becomes the Library's song): the progress line counts them as saved.
 */
const songsDownload = <S extends YtSong>(
  songs: readonly S[],
  { inLibrary, jobs }: SongsDownloadInput<S>,
  downloads: YtDownloads<S>,
  landed: number,
): YtSongsDownload<S> => {
  const statuses = songs.map((song) => ytDownloadStatus(downloads, song.videoId));
  const toDownload = requests(
    songs.filter((song, index) => {
      const status = statuses[index] ?? null;
      return !inLibrary(song) && !onItsWay(status) && status?.kind !== "failed";
    }),
    jobs,
  );
  const toCancel = songs
    .filter((_, index) => cancellable(statuses[index] ?? null))
    .map((song) => song.videoId);
  const toRetry = requests(
    songs.filter((song, index) => statuses[index]?.kind === "failed" && !inLibrary(song)),
    jobs,
  );
  // The list's batch: its songs downloaded or asked for this session.
  const batch = statuses.filter((status) => status !== null);
  const saved = batch.filter((status) => status.kind === "done").length + landed;
  const downloading = batch.some(onItsWay);
  const actions: YtSongsDownloadAction[] = [];
  if (toDownload.length > 0) actions.push("download");
  // Failures are retried together once the batch has ended; each keeps its own Retry meanwhile.
  if (toRetry.length > 0 && !downloading) actions.push("retryFailed");
  if (toCancel.length > 0) actions.push("cancel");
  return {
    actions,
    line: downloading ? `Downloading · ${saved} of ${batch.length + landed}` : null,
    toDownload,
    toRetry,
    toCancel,
  };
};

/**
 * Where downloading [songs], any list of YT Music songs, stands: Download
 * queues those the Library doesn't have and that aren't on their way, Cancel
 * the ones still cancellable, Retry Failed the failures once the rest has ended.
 */
export const ytSongsDownload = <S extends YtSong>(
  songs: readonly S[],
  input: SongsDownloadInput<S>,
): YtSongsDownload<S> => songsDownload(songs, input, ytDownloadsFromJournal(input.jobs), 0);

/** [view] with its entries named as [names] says. */
const named = <S extends YtSong, A extends string>(
  view: YtSongsDownload<S>,
  names: { readonly [K in YtSongsDownloadAction]: A },
): YtSongsDownload<S, A> => ({ ...view, actions: view.actions.map((action) => names[action]) });

const ALBUM_ACTIONS: { readonly [K in YtSongsDownloadAction]: YtAlbumDownloadAction } = {
  download: "downloadAlbum",
  retryFailed: "retryFailed",
  cancel: "cancelAlbumDownload",
};

/** Where downloading a YT Music album, its [songs], stands. */
export const ytAlbumDownload = <S extends YtSong>(
  songs: readonly S[],
  input: SongsDownloadInput<S>,
): YtAlbumDownload<S> => named(ytSongsDownload(songs, input), ALBUM_ACTIONS);

export type YtPlaylistDownloadAction =
  | "downloadPlaylist"
  | "retryFailed"
  | "cancelPlaylistDownload";

/** Where a playlist's download stands, and what acting on it does. */
export type YtPlaylistDownload<S extends YtSong = YtSong> = YtSongsDownload<
  S,
  YtPlaylistDownloadAction
>;

const PLAYLIST_ACTIONS: { readonly [K in YtSongsDownloadAction]: YtPlaylistDownloadAction } = {
  download: "downloadPlaylist",
  retryFailed: "retryFailed",
  cancel: "cancelPlaylistDownload",
};

/**
 * Where downloading a playlist holding [entries] stands: its YT Music
 * entries are the list, in playlist order; its Library songs have nothing to
 * download. A Library song whose file a download saved this session is an
 * entry that has taken its place, and counts as saved.
 */
export const ytPlaylistDownload = <S extends YtSong>(
  entries: readonly MixedSong<S, { readonly path: string | null }>[],
  input: SongsDownloadInput<S>,
): YtPlaylistDownload<S> => {
  const downloads = ytDownloadsFromJournal(input.jobs);
  const savedPaths = new Set(
    downloads.jobs.flatMap(({ status }) => (status.kind === "done" ? [status.path] : [])),
  );
  const songs = entries.flatMap((entry) => (entry.source === "stream" ? [entry.song] : []));
  const landed = entries.filter(
    (entry) =>
      entry.source === "library" && entry.track.path !== null && savedPaths.has(entry.track.path),
  ).length;
  return named(songsDownload(songs, input, downloads, landed), PLAYLIST_ACTIONS);
};

/** What each playlist entry says in the playlist's long-press menu. */
export const YT_PLAYLIST_DOWNLOAD_ACTION_LABELS: {
  readonly [A in YtPlaylistDownloadAction]: string;
} = {
  downloadPlaylist: "Download Playlist",
  retryFailed: "Retry Failed",
  cancelPlaylistDownload: "Cancel Playlist Download",
};

/** The generic entry each named one stands for. */
const GENERIC_ACTIONS: {
  readonly [A in YtAlbumDownloadAction | YtPlaylistDownloadAction]: YtSongsDownloadAction;
} = {
  downloadAlbum: "download",
  downloadPlaylist: "download",
  retryFailed: "retryFailed",
  cancelAlbumDownload: "cancel",
  cancelPlaylistDownload: "cancel",
};

/** A page's download button: [view]'s first entry, named short, or null when it offers none. */
const button = <A extends YtAlbumDownloadAction | YtPlaylistDownloadAction>(
  view: YtSongsDownload<YtSong, A>,
): { readonly action: A; readonly label: string } | null => {
  const action = view.actions[0];
  return action === undefined ? null : { action, label: BUTTON_LABELS[GENERIC_ACTIONS[action]] };
};

/** The album page's download button: the album's first entry, or null when it offers none. */
export const ytAlbumDownloadButton = (
  view: YtAlbumDownload,
): { readonly action: YtAlbumDownloadAction; readonly label: string } | null => button(view);

/** The playlist page's download button: the playlist's first entry, or null when it offers none. */
export const ytPlaylistDownloadButton = (
  view: YtPlaylistDownload,
): { readonly action: YtPlaylistDownloadAction; readonly label: string } | null => button(view);
