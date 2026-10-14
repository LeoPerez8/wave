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
 * The Soulseek failures that hand a download over to YouTube Music
 * (`downloadFallback`), for the native journal to keep with the job: it meets
 * them where no answer from JS can be waited for.
 */
export const downloadFallbackFailures = (setup: DownloadFallbackSetup): YtDownloadFailure[] =>
  FALLS_BACK.filter((failure) => downloadFallback(failure, setup) !== null);

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
