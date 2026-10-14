/**
 * Where a YT Music song's download comes from. Soulseek gives the original
 * MP3 320 once the owner connected an account; YouTube Music gives the M4A it
 * serves (AAC 256 kbps with Premium, about 128 kbps without) while YT Music
 * is on, with or without a Google sign-in.
 */

import type { YtDownloadFailure } from "./ytDownloads.ts";

/** A download's source: the file it saves comes from one of them. */
export type DownloadSource = "soulseek" | "youtube";

/** What a download's source depends on. */
export interface DownloadSourceSetup {
  /** YT Music is on in Settings. */
  readonly ytMusicOn: boolean;
  /** Soulseek has an account saved, connected or not. */
  readonly soulseekAccount: boolean;
}

/**
 * The source a download uses: Soulseek while it has an account, else YouTube
 * Music while YT Music is on; null when neither is set up, which fails the
 * download with "Connect YT Music or Soulseek in Settings".
 */
export const downloadSource = ({
  ytMusicOn,
  soulseekAccount,
}: DownloadSourceSetup): DownloadSource | null =>
  soulseekAccount ? "soulseek" : ytMusicOn ? "youtube" : null;

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
