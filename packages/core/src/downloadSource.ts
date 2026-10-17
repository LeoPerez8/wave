/**
 * Where a YT Music song's download comes from. Soulseek gives the original
 * MP3 320 while Download in best quality is on; YouTube Music gives the M4A it
 * serves (AAC 256 kbps with Premium, about 128 kbps without) while YT Music
 * is on, with or without a Google sign-in.
 */

import { spotifyYtMatch } from "./spotifyImport.ts";
import type { YtDownloadFailure } from "./ytDownloads.ts";
import type { YtSong } from "./ytMusic.ts";
import { formatDuration } from "./time.ts";

/** A download's source: the file it saves comes from one of them. */
export type DownloadSource = "soulseek" | "youtube";

/** What a download's source depends on. */
export interface DownloadSourceSetup {
  /** YT Music is on in Settings. */
  readonly ytMusicOn: boolean;
  /** Download in best quality is on in Settings, connected to Soulseek or not. */
  readonly bestQuality: boolean;
  /**
   * The song is a YouTube Music video it was downloaded from before: a
   * missing song with a video id, which downloads that video again.
   */
  readonly video?: boolean;
}

/**
 * The source a download uses: Soulseek while Download in best quality is on,
 * else YouTube Music while YT Music is on; null when both are off, which fails
 * the download with "Turn on YT Music or Download in best quality in Settings".
 * A missing song with a video id ([video]) comes from that video while YT
 * Music is on, whatever Download in best quality says.
 */
export const downloadSource = ({
  ytMusicOn,
  bestQuality,
  video = false,
}: DownloadSourceSetup): DownloadSource | null =>
  video && ytMusicOn ? "youtube" : bestQuality ? "soulseek" : ytMusicOn ? "youtube" : null;

/** What Soulseek's fallback depends on. */
export interface DownloadFallbackSetup {
  /** YT Music is on in Settings. */
  readonly ytMusicOn: boolean;
}

/**
 * Soulseek failures that YouTube Music may still get past: no copy in 320 kbps
 * (or every peer failed), an account Soulseek rejected or no longer has, a
 * server that can't be reached while the phone is online, and an attempt that
 * ran out of time. Offline, full storage and an unwritable folder would fail
 * YouTube the same way; Cancel is never a failure.
 */
const FALLS_BACK: readonly YtDownloadFailure[] = [
  "unavailable",
  "accountRejected",
  "account",
  "unreachable",
  "timedOut",
];

/**
 * Where a Soulseek download that failed with [failure] carries on: YouTube
 * Music while YT Music is on and the failure is one YouTube may get past; null
 * when the download ends with the failure, as it does without a fallback.
 */
export const downloadFallback = (
  failure: YtDownloadFailure,
  { ytMusicOn }: DownloadFallbackSetup,
): DownloadSource | null => (ytMusicOn && FALLS_BACK.includes(failure) ? "youtube" : null);

/**
 * What the native download journal does when a download's source fails it.
 * The journal meets these failures where no answer from JS can be waited for,
 * so the prepare answer gives it the plan for the job's source, and for
 * YouTube Music's fallback.
 */
export interface DownloadFailurePlan {
  /**
   * Failures tried again after a pause, on the same peer or YouTube's
   * stream, while the job has attempts left; then they end the download.
   */
  readonly retry: readonly YtDownloadFailure[];
  /**
   * Failures that end the download at once. Any other failure moves on to
   * the next peer, or starts YouTube's stream again.
   */
  readonly end: readonly YtDownloadFailure[];
  /** The failure once no peer, or no attempt at YouTube's stream, is left. */
  readonly exhausted: YtDownloadFailure;
  /** What audio that isn't the song fails the download with; null moves on to the next peer. */
  readonly rejected: YtDownloadFailure | null;
  /** Failures that hand the download over to YouTube Music instead of ending it (`downloadFallback`). */
  readonly fallsBack: readonly YtDownloadFailure[];
}

/**
 * Failures no other peer, nor YouTube's stream started again, would get
 * past: the account, the phone's storage or folders, YT Music turned off,
 * a song YouTube won't serve and Soulseek's server not answering.
 */
const ENDS: readonly YtDownloadFailure[] = [
  "account",
  "accountRejected",
  "unreachable",
  "storage",
  "noFolder",
  "noSource",
  "ytUnavailable",
];

/**
 * The journal's plan for a download from [source]. Offline is always tried
 * again; Soulseek's unreachable server too, unless YouTube Music can carry
 * the download on at once.
 */
export const downloadFailurePlan = (
  source: DownloadSource,
  setup: DownloadFallbackSetup,
): DownloadFailurePlan => {
  if (source === "youtube")
    return {
      retry: ["offline"],
      end: ENDS,
      exhausted: "failed",
      rejected: "ytUnavailable",
      fallsBack: [],
    };
  const fallsBack = FALLS_BACK.filter((failure) => downloadFallback(failure, setup) !== null);
  return {
    retry: fallsBack.includes("unreachable") ? ["offline"] : ["offline", "unreachable"],
    end: ENDS,
    exhausted: "unavailable",
    rejected: null,
    fallsBack,
  };
};

/**
 * Whether the audio YouTube served, [durationMs] long as decoded on the
 * phone, is the song: as long as the song's length, within 2 s or 2% of it,
 * whichever is more (the tolerance Soulseek's MP3 check allows). A song with
 * no known length takes any audio that has one.
 */
export const ytAudioMatches = (
  song: { readonly durationMs: number | null },
  durationMs: number,
): boolean => {
  if (!(durationMs > 0)) return false;
  if (song.durationMs === null || song.durationMs <= 0) return true;
  return Math.abs(durationMs - song.durationMs) <= Math.max(2_000, song.durationMs * 0.02);
};

/**
 * Why the audio YouTube served, [durationMs] long, isn't the song
 * (`ytAudioMatches`): the cause the confirm decision's rejection records, so
 * the failed download's row says it rather than an earlier source's failure.
 * Null when it is the song.
 */
export const ytAudioRejection = (
  song: { readonly durationMs: number | null },
  durationMs: number,
): string | null => {
  if (ytAudioMatches(song, durationMs)) return null;
  if (!(durationMs > 0) || song.durationMs === null) return "YouTube's audio has no length";
  return `YouTube's audio is ${formatDuration(durationMs)} long, but the song is ${formatDuration(song.durationMs)}`;
};

/**
 * The video a YouTube download of [song] asks for instead of its own: the
 * song's audio track among YT Music's Songs search [results] (which lists
 * audio tracks). YT Music's album pages may list a song under its music
 * video, whose audio runs longer or shorter than the album cut
 * (`ytAudioMatches` would turn it down). Null keeps the song's own video:
 * the search lists it, or nothing in it is the same recording by the rules
 * imports use (`spotifyYtMatch`), or there was no search.
 */
export const ytAudioTrack = (song: YtSong, results: readonly YtSong[] | null): string | null => {
  if (results === null || results.some((result) => result.videoId === song.videoId)) return null;
  return spotifyYtMatch(song, results)?.videoId ?? null;
};

/** What the app log says about one YouTube download once its audio is checked (`ytDownloadReport`). */
export interface YtDownloadReport {
  /** The video the song is listed under; null for a missing song, which has none of its own. */
  readonly song: string | null;
  /** The video the download asked YouTube for (`ytAudioTrack`'s, or the song's). */
  readonly requested: string;
  /** The video YouTube's answer was for, the client that gave it and its type (`MUSIC_VIDEO_TYPE_…`). */
  readonly resolved: string | null;
  readonly client: string | null;
  readonly videoType: string | null;
  /** The length YouTube's answer gave the video. */
  readonly announcedMs: number | null;
  /** The length the audio is checked against (`ytAudioMatches`), and where it came from. */
  readonly expectedMs: number | null;
  readonly expectedFrom: "ytMusic" | "library";
  /** How long the downloaded file plays. */
  readonly measuredMs: number;
}

const EXPECTED_FROM: Record<YtDownloadReport["expectedFrom"], string> = {
  ytMusic: "YT Music's listing",
  library: "its Library track",
};

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

/**
 * The app log's line for a YouTube download whose audio was checked: the
 * videos asked for and served, the client, the video type and the three
 * lengths, which together tell a music video from the song's audio track.
 */
export const ytDownloadReport = (report: YtDownloadReport): string => {
  const type = report.videoType?.replace(/^MUSIC_VIDEO_TYPE_/u, "") ?? "unknown type";
  const of = report.song === null ? "" : ` of ${report.song}`;
  const served = report.resolved ?? "an unknown video";
  const client = report.client ?? "an unknown client";
  const announced = report.announcedMs === null ? "no length" : seconds(report.announcedMs);
  const expected =
    report.expectedMs === null
      ? "the song has no length"
      : `the song is ${seconds(report.expectedMs)}`;
  return (
    `YouTube download${of}: asked for ${report.requested}, served ${served} (${type}) by ${client}; ` +
    `YouTube says ${announced}, ${expected} (${EXPECTED_FROM[report.expectedFrom]}), ` +
    `the file plays ${seconds(report.measuredMs)}`
  );
};
