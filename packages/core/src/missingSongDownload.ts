/**
 * Downloading missing songs (docs/spec.md, "Wave account and sync" ›
 * Downloading missing songs): a missing song's download job, where its
 * audio comes from, the tags its file gets, and what Settings › Wave
 * Account's Download All offers. Each song goes through the download
 * pipeline YT Music songs use, in a job named after its Track, so the file
 * fills that Track in.
 */

import { UNKNOWN_ALBUM } from "./library.ts";
import { songLookup, type FoundTags, type SongLookup } from "./lyricsAndGenre.ts";
import { spotifySearchQuery, spotifyYtMatch } from "./spotifyImport.ts";
import { largeCover, type YtDownloadTags } from "./ytDownload.ts";
import {
  ytDownloadStatus,
  ytDownloadsFromJournal,
  type YtDownloadFailure,
  type YtDownloadJournalJob,
  type YtDownloadStatus,
} from "./ytDownloads.ts";
import type { YtSong } from "./ytMusic.ts";

const JOB_PREFIX = "missing:";

/** A missing song as a download takes it: its Track's tags, as the Library keeps them. */
export interface MissingTrack {
  /** Its Track: the file fills this Track in. */
  readonly id: number;
  readonly title: string;
  /** Its artist credit, as one line. */
  readonly artist: string;
  /** The artists the credit names, the main artist first. */
  readonly artists: readonly string[];
  /** `Unknown Album` without one. */
  readonly album: string;
  readonly albumArtist: string;
  readonly year: number | null;
  readonly trackNumber: number | null;
  readonly discNumber: number | null;
  readonly genre: string | null;
  /** 0 when unknown. */
  readonly durationMs: number;
  /** The YouTube Music video it was downloaded from, when it was. */
  readonly videoId: string | null;
}

/** What a missing song's job keeps of its Track besides what a YT Music song has. */
export interface MissingSongJobTags {
  /** The Track the download fills in. */
  readonly trackId: number;
  readonly artist: string;
  readonly album: string;
  readonly albumArtist: string;
  readonly year: number | null;
  readonly trackNumber: number | null;
  readonly discNumber: number | null;
  readonly genre: string | null;
  readonly videoId: string | null;
}

/**
 * The download journal's id for a missing song's job: `missing:<trackId>`,
 * named after the Track it fills in. A YT Music song's job goes by its
 * video's id; this one never names a video.
 */
export type MissingSongJobId = `${typeof JOB_PREFIX}${number}`;

/**
 * A missing song as the download journal holds it: shaped like a YT Music
 * song, so rows, matching and the journal take it as they take one. The
 * journal names a job after its song's `videoId`, so that field holds the
 * job's id (`MissingSongJobId`); the video it downloads, when it has one, is
 * `missing.videoId`.
 */
export interface MissingSongJob extends YtSong {
  readonly videoId: MissingSongJobId;
  readonly missing: MissingSongJobTags;
}

/** The download job of the missing song whose Track is [trackId]. */
export const missingSongJobId = (trackId: number): MissingSongJobId => `${JOB_PREFIX}${trackId}`;

/** The Track download job [jobId] fills in; null for any other job (a YT Music song's). */
export const missingSongTrackId = (jobId: string): number | null => {
  if (!jobId.startsWith(JOB_PREFIX)) return null;
  const id = jobId.slice(JOB_PREFIX.length);
  return /^\d+$/.test(id) ? Number(id) : null;
};

/** Missing song [track] shaped as a YT Music song named [videoId]: what isn't known is null. */
const asYtSong = <Id extends string>(
  track: MissingTrack,
  videoId: Id,
): YtSong & { readonly videoId: Id } => ({
  videoId,
  title: track.title,
  artists: track.artists.length > 0 ? track.artists : [track.artist],
  album: track.album === UNKNOWN_ALBUM || track.album === "" ? null : track.album,
  durationMs: track.durationMs > 0 ? track.durationMs : null,
  artworkUrl: null,
  explicit: false,
});

/**
 * Missing song [track] as YT Music's song of the video it was downloaded
 * from (what its playlist entries become once signed out, Core's
 * `signOutPlan`); null for one that never came from YouTube Music.
 */
export const missingSongYtSong = (track: MissingTrack): YtSong | null =>
  track.videoId === null ? null : asYtSong(track, track.videoId);

/** The job that downloads missing song [track]. */
export const missingSongJob = (track: MissingTrack): MissingSongJob => ({
  ...asYtSong(track, missingSongJobId(track.id)),
  missing: {
    trackId: track.id,
    artist: track.artist,
    album: track.album,
    albumArtist: track.albumArtist,
    year: track.year,
    trackNumber: track.trackNumber,
    discNumber: track.discNumber,
    genre: track.genre,
    videoId: track.videoId,
  },
});

/**
 * What YouTube Music is searched for to find missing song [job]'s video:
 * its title and artists, all that is sent; null for a song with a video id,
 * which downloads that video.
 */
export const missingSongSearch = (job: MissingSongJob): string | null =>
  job.missing.videoId === null ? spotifySearchQuery(job) : null;

/**
 * A YouTube Music video a missing song downloads, and its cover when the
 * search showed one. A song's own video comes without: the app reads its
 * cover from the video's album page, as a YT Music song's download does.
 */
export interface MissingSongVideo {
  readonly videoId: string;
  readonly artworkUrl: string | null;
}

/**
 * The video missing song [job] downloads from YouTube Music: the one it was
 * downloaded from before, else the first of YouTube Music's [results] for
 * `missingSongSearch` that is the recording, by the rules downloads use
 * (`spotifyYtMatch`: title, main artist, edition, and length within 3
 * seconds). Null when nothing is, or nothing was searched.
 */
export const missingSongVideo = (
  job: MissingSongJob,
  results: readonly YtSong[] | null,
): MissingSongVideo | null => {
  if (job.missing.videoId !== null) return { videoId: job.missing.videoId, artworkUrl: null };
  const match = results === null ? null : spotifyYtMatch(job, results);
  return match === null ? null : { videoId: match.videoId, artworkUrl: match.artworkUrl };
};

/** What missing song [job]'s lyrics and genre are looked up by; null when it can't be told apart. */
export const missingSongLookup = (job: MissingSongJob): SongLookup | null =>
  songLookup({
    title: job.title,
    artist: job.missing.artist,
    album: job.missing.album,
    durationMs: job.durationMs ?? 0,
  });

/**
 * The tags missing song [job]'s file gets: its Track's, so the file is the
 * same recording for the Wave account (Core's `recordingKey`), with what
 * the Track has no tag for from the lookup's [found] (lyrics, and a genre,
 * year or track number) and the cover of the video it comes from
 * ([artworkUrl], asked for large), when there is one.
 */
export const missingSongTags = (
  job: MissingSongJob,
  found: FoundTags | null,
  artworkUrl: string | null,
): YtDownloadTags => {
  const { missing } = job;
  // The number and its disc come from one source: the Track, else the lookup.
  const place =
    missing.trackNumber !== null
      ? { trackNumber: missing.trackNumber, discNumber: missing.discNumber }
      : { trackNumber: found?.trackNumber ?? null, discNumber: found?.discNumber ?? null };
  return {
    title: job.title,
    artist: missing.artist,
    album: job.album,
    albumArtist: missing.albumArtist,
    year: missing.year ?? found?.year ?? null,
    ...place,
    genre: missing.genre ?? found?.genre ?? null,
    lyrics: found?.lyrics?.text ?? null,
    artworkUrl: artworkUrl === null ? null : largeCover(artworkUrl),
  };
};

/** What Settings › Wave Account's Download All offers: Download All, Retry Failed, Cancel. */
export type MissingSongsDownloadAction = "downloadAll" | "retryFailed" | "cancel";

export const MISSING_SONGS_DOWNLOAD_ACTION_LABELS: {
  readonly [A in MissingSongsDownloadAction]: string;
} = {
  downloadAll: "Download All",
  retryFailed: "Retry Failed",
  cancel: "Cancel",
};

/** Where downloading the missing songs stands, and what acting on it does. */
export interface MissingSongsDownload<S extends YtSong> {
  /**
   * "312 songs aren't on this phone", or while they download "Downloading ·
   * N of M" (M: the missing songs downloaded or asked for this session, N:
   * those saved); null with none missing and nothing on its way.
   */
  readonly line: string | null;
  /** The entries offered, in order. */
  readonly actions: readonly MissingSongsDownloadAction[];
  /** What Download All queues, in order: the songs not on their way and not failed. */
  readonly toDownload: readonly S[];
  /** What Retry Failed asks for again, in order: the songs whose download failed. */
  readonly toRetry: readonly S[];
  /** The jobs Cancel cancels: songs queued or downloading, not yet saving. */
  readonly toCancel: readonly string[];
  /**
   * Once nothing is on its way, the songs nothing matched (no Soulseek copy,
   * no YouTube Music match, a video YouTube won't serve): they stay missing
   * and the summary lists them. Null when there are none, or before then.
   */
  readonly summary: { readonly line: string; readonly songs: readonly S[] } | null;
}

/** Failures that mean no source has the song, rather than that downloading it failed. */
const NOT_FOUND: readonly YtDownloadFailure[] = ["notFound", "unavailable", "ytUnavailable"];

const onItsWay = (status: YtDownloadStatus | null): boolean =>
  status?.kind === "queued" || status?.kind === "downloading" || status?.kind === "saving";

const cancellable = (status: YtDownloadStatus | null): boolean =>
  status?.kind === "queued" || status?.kind === "downloading";

const counted = (count: number, one: string, many: string): string =>
  `${count.toLocaleString("en")} ${count === 1 ? one : many}`;

/**
 * Where downloading the [missing] songs (their jobs, `missingSongJob`)
 * stands, from the download journal's [jobs]: Download All queues the songs
 * not on their way, Cancel stops the ones still cancellable, and once the
 * rest has ended Retry Failed asks again for the failures, as an album's
 * download does. A song filled in is no longer missing; its job still counts
 * as saved on the progress line.
 */
export const missingSongsDownload = <S extends YtSong>(
  missing: readonly S[],
  jobs: readonly YtDownloadJournalJob[],
): MissingSongsDownload<S> => {
  const downloads = ytDownloadsFromJournal(jobs.filter((job) => job.id.startsWith(JOB_PREFIX)));
  const statuses = missing.map((song) => ytDownloadStatus(downloads, song.videoId));
  const listed = new Set(missing.map((song) => song.videoId));
  // Filled in: saved this session, and no longer missing.
  const landed = downloads.jobs.filter(
    (job) => job.status.kind === "done" && !listed.has(job.song.videoId),
  ).length;
  const failed = (index: number) => statuses[index]?.kind === "failed";
  const toDownload = missing.filter(
    (_, index) => !onItsWay(statuses[index] ?? null) && !failed(index),
  );
  const toRetry = missing.filter((_, index) => failed(index));
  const toCancel = missing
    .filter((_, index) => cancellable(statuses[index] ?? null))
    .map((song) => song.videoId);
  const batch = statuses.filter((status) => status !== null);
  const downloading = batch.some(onItsWay);
  const saved = batch.filter((status) => status.kind === "done").length + landed;
  const actions: MissingSongsDownloadAction[] = [];
  if (toDownload.length > 0) actions.push("downloadAll");
  if (toRetry.length > 0 && !downloading) actions.push("retryFailed");
  if (toCancel.length > 0) actions.push("cancel");
  const notFound = downloading
    ? []
    : missing.filter((_, index) => {
        const status = statuses[index];
        return status?.kind === "failed" && NOT_FOUND.includes(status.reason);
      });
  return {
    line: downloading
      ? `Downloading · ${saved} of ${batch.length + landed}`
      : missing.length === 0
        ? null
        : `${counted(missing.length, "song isn't", "songs aren't")} on this phone`,
    actions,
    toDownload,
    toRetry,
    toCancel,
    summary:
      notFound.length === 0
        ? null
        : {
            line: `${counted(notFound.length, "song wasn't", "songs weren't")} found`,
            songs: notFound,
          },
  };
};
