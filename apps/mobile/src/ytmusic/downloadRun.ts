import { currentLocalisation, subscribeLocalisation } from "@/localisation/localisation";
import {
  NO_DOWNLOAD_RUN,
  downloadRunNotice,
  downloadRunProgress,
  downloadTimeLeft,
  downloadsPaused,
  followDownloadRun,
  keptDownloadRun,
  restoredDownloadRun,
  type DownloadRun,
  type DownloadRunProgress,
} from "@wave/core";
import { Storage } from "expo-sqlite/kv-store";
import { useEffect, useState } from "react";

import { WaveSoulseek } from "@/native/waveSoulseek";

import { journal, queuedCountsNow } from "./downloadJournal";
import { onYoutubePauseChanged, youtubePausedUntil } from "./youtubeThrottle";

/**
 * The run (Core's `followDownloadRun`): the songs queued since the queue was last empty,
 * followed through every journal change from launch, whether Settings › Downloads is open or
 * not, and kept across restarts (Core's `keptDownloadRun`) so its counts carry on.
 */
let downloadRun: DownloadRun = NO_DOWNLOAD_RUN;
let following = false;

/** Where the kv-store keeps the run across restarts. */
const RUN_KEY = "downloads.run";
let keptShown: string | null = null;

/**
 * Follows the run from now on, from what the kv-store kept of it: the app and the headless task
 * call it as they start the downloads (`startDownloads`); later calls change nothing.
 */
export const followDownloadRuns = (): void => {
  if (following) return;
  following = true;
  keptShown = Storage.getItemSync(RUN_KEY);
  downloadRun = restoredDownloadRun(keptShown, Date.now());
  journal.subscribe(() => {
    downloadRun = followDownloadRun(downloadRun, journal.get(), Date.now());
    showRunSoon();
  });
  // A pause on YouTube's downloads takes the time left away, and its end brings it back.
  onYoutubePauseChanged(showRunSoon);
  subscribeLocalisation(showRunSoon);
};

/** How often the download notification and the kv-store hear of the run: at most about once a second. */
const RUN_NOTICE_MS = 1_000;
let runNoticeTimer: ReturnType<typeof setTimeout> | null = null;
let runNoticeShown = "null";

const showRunSoon = () => {
  runNoticeTimer ??= setTimeout(showRun, RUN_NOTICE_MS);
};

/**
 * Tells the download notification how the run goes (Core's `downloadRunNotice`), and has the
 * kv-store keep it, when that changed: a run's journal changes many times a second, so this
 * follows them about once a second.
 */
const showRun = () => {
  runNoticeTimer = null;
  const kept = keptDownloadRun(downloadRun);
  if (kept !== keptShown) {
    keptShown = kept;
    if (kept === null) Storage.removeItemSync(RUN_KEY);
    else Storage.setItemSync(RUN_KEY, kept);
  }
  const { progress, timeLeft } = downloadRunNow();
  const notice = downloadRunNotice(progress.overall, timeLeft, currentLocalisation().language);
  const key = JSON.stringify(notice);
  if (key === runNoticeShown) return;
  runNoticeShown = key;
  WaveSoulseek.showDownloadRun(notice);
};

/** Settings › Downloads' run panel: the run's counts, overall and per group, and its time left. */
export interface DownloadRunState {
  readonly progress: DownloadRunProgress;
  /** Ms, or null until there's a pace and while paused (Core's `downloadTimeLeft`). */
  readonly timeLeft: number | null;
  /**
   * YouTube is limiting downloads, or songs are left but none is downloading or saving (Core's
   * `downloadsPaused`).
   */
  readonly paused: boolean;
}

/** How often the run panel reads the run again: at most about once a second. */
const RUN_PANEL_MS = 1_000;

const downloadRunNow = (): DownloadRunState => {
  const now = Date.now();
  const paused = downloadsPaused(queuedCountsNow(), {
    youtubePausedUntil: youtubePausedUntil(),
    now,
  });
  return {
    progress: downloadRunProgress(downloadRun),
    timeLeft: downloadTimeLeft(downloadRun, { now, paused }),
    paused,
  };
};

/** What the panel shows of [state], to skip a render when a second changed nothing. */
const runStateKey = ({ progress, timeLeft, paused }: DownloadRunState): string =>
  JSON.stringify([
    progress.overall,
    [...progress.groups],
    timeLeft === null ? null : Math.round(timeLeft / 60_000),
    paused,
  ]);

/**
 * The run as Settings › Downloads' panel shows it, read again about once a second (not on each
 * journal change, which a big run makes many times a second) and only rendered when it changed.
 */
export const useDownloadRun = (): DownloadRunState => {
  const [state, setState] = useState(downloadRunNow);
  useEffect(() => {
    // The first tick renders once more at most: it may follow a change since the first render.
    let key = "";
    const timer = setInterval(() => {
      const next = downloadRunNow();
      const nextKey = runStateKey(next);
      if (nextKey === key) return;
      key = nextKey;
      setState(next);
    }, RUN_PANEL_MS);
    return () => clearInterval(timer);
  }, []);
  return state;
};
