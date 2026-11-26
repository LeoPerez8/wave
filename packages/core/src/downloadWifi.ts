/**
 * Download only on Wi-Fi (docs/spec.md, YT Music › Downloads on Wi-Fi): while it's on, a download
 * waits on a metered network (mobile data, a hotspot, a Wi-Fi marked metered: Android's
 * `NET_CAPABILITY_NOT_METERED` is missing) and runs once an unmetered one is back. The native
 * journal (`DurableDownloads`) mirrors this rule and marks each job it holds `waitingForWifi`.
 */

import { en, type Catalogue } from "./catalogueEn.ts";
import type { DownloadSource } from "./downloadSource.ts";
import { missingSongJobId } from "./missingSongDownload.ts";
import { parseTrackId } from "./ytMusic.ts";
import { ytDownloadUnfinished, type YtDownloadJournalJob } from "./ytDownloads.ts";

/** Where the switch is kept; it syncs with the Wave account. */
export const DOWNLOAD_WIFI_ONLY_SETTING = "settings.downloadWifiOnly";

/** On unless the owner turned it off, for existing users too (nothing stored reads as on). */
export const readDownloadWifiOnly = (stored: string | null): boolean => stored !== "off";

export const writeDownloadWifiOnly = (on: boolean): string | null => (on ? null : "off");

/** The switch and the network the phone is on now. */
export interface DownloadNetwork {
  /** Download only on Wi-Fi is on. */
  readonly wifiOnly: boolean;
  /** The network is metered: mobile data, a hotspot, a Wi-Fi marked metered. */
  readonly metered: boolean;
}

/** What of a job the rule reads. */
export interface WifiWaitJob {
  /** Where its audio comes from; a job from before there was a choice is Soulseek's. */
  readonly source?: DownloadSource;
  /**
   * The owner played the song while it waited: playing streams the same audio, so it downloads now
   * over whatever network there is.
   */
  readonly playNow?: boolean;
}

/**
 * Whether a job not downloaded yet waits for Wi-Fi: the switch is on and the network metered,
 * unless the owner played the song. A best-quality (Soulseek) copy waits all the same: the song
 * plays streamed and the bigger file waits.
 */
export const downloadWaitsForWifi = (network: DownloadNetwork, job: WifiWaitJob): boolean =>
  network.wifiOnly && network.metered && !(job.playNow === true && job.source === "youtube");

/** How many songs on their way wait for Wi-Fi, as the journal marked them. */
export const downloadsWaitingForWifi = (jobs: readonly YtDownloadJournalJob[]): number =>
  jobs.filter((job) => job.waitingForWifi === true && ytDownloadUnfinished(job)).length;

/** Settings › Downloads' line at the top of its list ("Waiting for Wi-Fi · 12 songs"); null when none wait. */
export const wifiWaitLine = (
  jobs: readonly YtDownloadJournalJob[],
  catalogue: Catalogue = en,
): string | null => {
  const count = downloadsWaitingForWifi(jobs);
  return count === 0 ? null : catalogue.downloadStatus.waitingForWifiCount(count);
};

/**
 * The download waiting for Wi-Fi that the song [trackId] just started playing belongs to (a
 * streamed song's, by its video or one on the job, or a missing song's), which the journal then
 * lets download now (`playNow`); null when none waits.
 */
export const wifiWaitPlayed = (
  jobs: readonly YtDownloadJournalJob[],
  trackId: string | null,
): string | null => {
  const ref = trackId === null ? null : parseTrackId(trackId);
  if (ref === null) return null;
  const waiting = jobs.filter((job) => job.waitingForWifi === true && ytDownloadUnfinished(job));
  if (ref.kind === "library") {
    const id = missingSongJobId(ref.id);
    return waiting.some((job) => job.id === id) ? id : null;
  }
  const played = waiting.find((job) =>
    [job.song, ...(job.aliases ?? [])].some((song) => song.videoId === ref.videoId),
  );
  return played?.id ?? null;
};
