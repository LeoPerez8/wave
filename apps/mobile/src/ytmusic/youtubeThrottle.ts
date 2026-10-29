import { ytThrottleNotice, ytThrottleRead, ytThrottleRestored, type YtThrottle } from "@wave/core";
import { useEffect, useSyncExternalStore } from "react";

import { makeExternalStore } from "@/lib/externalStore";
import { currentLocalisation, subscribeLocalisation } from "@/localisation/localisation";
import { appLog } from "@/log/appLog";
import { WaveSoulseek, type NativeDownloadJob } from "@/native/waveSoulseek";

/**
 * When YouTube limits downloads (docs/spec.md, Downloads): Core's `ytThrottle` reads the
 * journal's refusals and served streams, and the journal pauses YouTube's jobs as it decides.
 */
let state: YtThrottle | null = null;
let restoring: Promise<YtThrottle> | null = null;
const pausedUntil = makeExternalStore<number | null>(null);

/**
 * The throttle as the journal kept it across restarts: its pause and backoff, and whether a
 * stream it holds was served, read from [jobs] or else a snapshot of the journal.
 */
const restored = (jobs?: readonly NativeDownloadJob[]): Promise<YtThrottle> =>
  (restoring ??= Promise.all([
    WaveSoulseek.youtubePause().catch(() => null),
    jobs ?? WaveSoulseek.jobsSnapshot().catch((): readonly NativeDownloadJob[] => []),
  ]).then(([pause, journal]) => {
    state ??= ytThrottleRestored(pause, Date.now(), journal);
    pausedUntil.set(state.pausedUntil);
    return state;
  }));

/** Until when YouTube's downloads are paused (epoch ms), as last decided; null before any pause. */
export const youtubePausedUntil = (): number | null => pausedUntil.get();

/** Calls [listener] whenever YouTube's pause changes; returns how to stop. */
export const onYoutubePauseChanged = (listener: () => void): (() => void) =>
  pausedUntil.subscribe(listener);

let following = Promise.resolve();

/**
 * Reads what the journal's [jobs] say about YouTube since last time; a burst pauses YouTube's
 * jobs, and a download that works lifts the backoff. Calls run one after another.
 */
export const followYoutubeThrottle = (jobs: readonly NativeDownloadJob[]): Promise<void> =>
  (following = following
    .then(async () => {
      const before = state ?? (await restored(jobs));
      const next = ytThrottleRead(before, jobs);
      state = next;
      if (next.pausedUntil === before.pausedUntil && next.level === before.level) return;
      pausedUntil.set(next.pausedUntil);
      if (next.pausedUntil !== before.pausedUntil && next.pausedUntil !== null)
        appLog(
          "warn",
          "downloads",
          `YouTube is limiting downloads: ${next.level === 1 ? "a burst" : `burst ${next.level}`} of refusals pauses YouTube's songs until ${new Date(next.pausedUntil).toISOString()}`,
        );
      await WaveSoulseek.pauseYoutube(next.pausedUntil ?? 0, next.level);
    })
    .catch(() => undefined));

/** How often the paused line counts down. */
const TICK_MS = 15_000;

/**
 * Settings › Downloads' line while YouTube downloads are paused (Core's `ytThrottleNotice`),
 * counting down to the next try; null when they aren't paused.
 */
export const useYoutubePauseNotice = (): string | null => {
  useEffect(() => {
    void restored();
  }, []);
  return useSyncExternalStore(subscribeNotice, notice);
};

/** The line now: the same string between ticks, so a render reads a stable value. */
const notice = (): string | null =>
  ytThrottleNotice(pausedUntil.get(), Date.now(), currentLocalisation().language);

/** Follows the pause, and ticks while one is on so the minutes count down. */
const subscribeNotice = (changed: () => void): (() => void) => {
  const unsubscribe = pausedUntil.subscribe(changed);
  const unsubscribeLanguage = subscribeLocalisation(changed);
  const tick = setInterval(() => {
    if (pausedUntil.get() !== null) changed();
  }, TICK_MS);
  return () => {
    unsubscribe();
    unsubscribeLanguage();
    clearInterval(tick);
  };
};
