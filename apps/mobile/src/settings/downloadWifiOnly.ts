import {
  DOWNLOAD_WIFI_ONLY_SETTING,
  readDownloadWifiOnly,
  writeDownloadWifiOnly,
} from "@wave/core";

import { persistedSetting } from "@/lib/persistedSetting";
import { WaveSoulseek } from "@/native/waveSoulseek";

/** Hands the switch to the download journal, which the download service follows with Wave closed. */
const tellJournal = (on: boolean): void => {
  void WaveSoulseek.setDownloadWifiOnly(on).catch((error: unknown) => {
    console.warn("[wave] Couldn't hand Download only on Wi-Fi to the downloads", error);
  });
};

/**
 * Download only on Wi-Fi (Settings › Downloads, #1502): on by default, for existing users too, and
 * synced with the Wave account. On a metered network the downloads wait for Wi-Fi (Core's
 * `downloadWaitsForWifi`, which the native journal mirrors).
 */
const downloadWifiOnlySetting = persistedSetting<boolean>({
  key: DOWNLOAD_WIFI_ONLY_SETTING,
  synced: true,
  read: readDownloadWifiOnly,
  write: writeDownloadWifiOnly,
  onValue: tellJournal,
});

export const downloadWifiOnly = downloadWifiOnlySetting.get;

export const setDownloadWifiOnly = downloadWifiOnlySetting.set;

/** Whether Download only on Wi-Fi is on; re-renders when it changes. */
export const useDownloadWifiOnly = downloadWifiOnlySetting.useValue;

/** At launch: the journal gets the switch as stored here, before any download is asked for. */
export const applyDownloadWifiOnly = (): void => tellJournal(downloadWifiOnly());
