/**
 * Download only on Wi-Fi (docs/spec.md, YT Music › Downloads on Wi-Fi): while it's on, a download
 * waits on a metered network (mobile data, a hotspot, a Wi-Fi marked metered: Android's
 * `NET_CAPABILITY_NOT_METERED` is missing) and runs once an unmetered one is back. The native
 * journal (`DurableDownloads`) mirrors this rule and marks each job it holds `waitingForWifi`.
 */

import { en, type Catalogue } from "./catalogueEn.ts";
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

/**
 * Whether a job not downloaded yet waits for Wi-Fi: the switch is on and the network metered,
 * whatever its source (a best-quality Soulseek copy too). Playing a waiting song only streams it: its download keeps waiting for an
 * unmetered network, on any play (a tap, auto-advance, Android Auto).
 */
export const downloadWaitsForWifi = (network: DownloadNetwork): boolean =>
  network.wifiOnly && network.metered;

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
