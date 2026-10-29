import { formatNumber } from "../formatting.ts";
import { plural } from "../plural.ts";

/**
 * A YT Music download as rows and Settings › Downloads show it (`ytDownloadLine`,
 * `queuedDownloadsSummary`, `downloadsSummary`).
 */
export const downloadStatusEn = {
  queued: "Waiting to download",
  connecting: "Connecting",
  searching: "Finding this recording",
  validating: "Checking the download",
  downloading: "Downloading",
  downloadingPercent: (percent: number) => `Downloading · ${percent}%`,
  saving: "Saving to the Library",
  done: "In the Library",
  /** Why a download failed, by `YtDownloadFailure`. */
  failures: {
    offline: "Download failed: offline",
    failed: "Download failed",
    timedOut: "Download failed",
    noFolder: "Download failed: no music folder",
    storage: "Download failed: couldn't save the file",
    account: "Turn on Download in best quality in Settings",
    // A rejected account is forgotten and the switch turned off; turning it on makes a new one.
    accountRejected: "Turn on Download in best quality in Settings",
    unreachable: "Download failed: Soulseek can't be reached",
    unavailable: "This recording is unavailable in 320 kbps",
    noSource: "Turn on YT Music or Download in best quality in Settings",
    ytUnavailable: "This song is unavailable on YouTube Music",
    notFound: "Not found online",
  },
  /** While YouTube downloads are paused (`ytThrottleNotice`). */
  youtubePaused: (minutes: number) =>
    `Paused: YouTube is limiting downloads. Next try in ${formatNumber("en", minutes)} min`,
  downloadingCount: (n: number) => `${formatNumber("en", n)} downloading`,
  savingCount: (n: number) => `${formatNumber("en", n)} saving`,
  waitingCount: (n: number) => `${formatNumber("en", n)} waiting`,
  failedSongs: (n: number) =>
    `${formatNumber("en", n)} ${plural("en", n, { one: "song", other: "songs" })} failed`,
};
