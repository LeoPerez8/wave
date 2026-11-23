import { formatNumber } from "../formatting.ts";
import { plural } from "../plural.ts";

const n = (count: number): string => formatNumber("en", count);
const songs = (count: number): string =>
  plural("en", count, { one: `${n(count)} song`, other: `${n(count)} songs` });

/**
 * A YT Music album's or playlist's Download (`ytSongsDownload`), Settings ›
 * Downloads' groups (`downloadingList`) and the quality replacement offers
 * (`qualityUpgradeOffer`, `qualityDowngradeOffer`).
 */
export const downloadsEn = {
  /** An album's long-press menu entries. */
  albumActions: {
    downloadAlbum: "Download Album",
    retryFailed: "Retry Failed",
    cancelAlbumDownload: "Cancel Album Download",
  },
  /** A playlist's long-press menu entries. */
  playlistActions: {
    downloadPlaylist: "Download Playlist",
    retryFailed: "Retry Failed",
    cancelPlaylistDownload: "Cancel Playlist Download",
  },
  /** The same entries as the page's button beside Play and Shuffle, where room is short. */
  buttons: {
    download: "Download",
    retryFailed: "Retry Failed",
    cancel: "Cancel",
  },
  /** The page's button once every song of the list is downloaded, a playlist's menu entry then, and its toast. */
  downloaded: "Downloaded",
  /** The page head's progress line. */
  progress: (saved: number, total: number): string => `Downloading · ${saved} of ${total}`,
  /** The same line while the list's downloads are paused (#1475). */
  pausedProgress: (saved: number, total: number): string => `Paused · ${saved} of ${total}`,
  /** The group of songs asked for on their own. */
  songsGroup: "Songs",
  songsLeft: (count: number): string => `${songs(count)} left`,
  /** A paused group's header, with no run to count it. */
  pausedSongsLeft: (count: number): string => `Paused · ${songs(count)} left`,
  /** The groups replacement runs wait in, by direction. */
  qualityGroups: {
    upgrade: "Quality upgrade",
    downgrade: "Free up space",
  },
  /** A storage size's units (`formatStorageSize`). */
  megabytes: (size: string): string => `${size} MB`,
  gigabytes: (size: string): string => `${size} GB`,
  /** The replacement offers' card and Settings › Downloads' row. */
  quality: {
    upgradeTitle: (count: number): string => `Replace ${songs(count)} with best quality?`,
    upgradeRow: (count: number): string => `Replace ${songs(count)} with best quality`,
    upgradeEstimate: (size: string): string => `About +${size}`,
    downgradeTitle: (size: string, count: number): string =>
      `Free about ${size} by replacing ${songs(count)} with YouTube Music copies?`,
    downgradeRow: (count: number): string => `Free up space: replace ${songs(count)}`,
    downgradeEstimate: (size: string): string => `Frees about ${size}`,
    copies: (kbps: number, exact: boolean): string =>
      `YouTube Music's copies are AAC at ${exact ? "" : "about "}${kbps} kbps.`,
    mobileData: (size: string): string =>
      `It downloads about ${size}, and the phone isn't on Wi-Fi.`,
    replace: "Replace",
    notNow: "Not now",
  },
  /** Settings › Downloads' run panel: Pause or Resume every download, and Cancel All with its question. */
  run: {
    pause: "Pause",
    resume: "Resume",
    cancelAll: "Cancel All",
    cancelAllTitle: (count: number): string =>
      `Cancel ${n(count)} ${plural("en", count, { one: "download", other: "downloads" })}?`,
    cancelAllMessage: "Songs already downloaded stay, and failed songs stay in the failed list.",
    keepDownloading: "Keep Downloading",
    /** One playlist's, album's or other group's Cancel (#1475), asking with `cancelAllTitle`. */
    cancelGroup: "Cancel Downloads",
    cancelGroupMessage: "Songs already downloaded stay.",
    /** A group's Pause and Resume in a playlist's or album's menu. */
    pauseGroup: "Pause Downloads",
    resumeGroup: "Resume Downloads",
  },
};
