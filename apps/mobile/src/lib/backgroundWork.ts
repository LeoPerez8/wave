/**
 * Background work's turns (Core's `createBackgroundWork`, #315): startup
 * work (the scan, resumed imports, sync, priming playlists, resumed
 * downloads) waits until the first screen has globally settled and quiet frames have passed
 * (or, with Wave in the background, for free turns alone), and work in
 * slices (a scan's saves, a sync's database steps, a rescan on return) takes
 * each slice on a free turn, after the owner's touch and the motion it
 * started, never holding the JavaScript thread for a tap.
 */
import { createBackgroundWork } from "@wave/core";
import * as Effect from "effect/Effect";
import { AppState, type GestureResponderEvent } from "react-native";

import { isScreenSettled, onScreenSettled } from "./timing";
import { createStartupWork } from "./startupWork";

import { WaveAppLog } from "@/native/waveAppLog";
import { openWhileBackgrounded, settledTurn } from "./settledWork";

import { perfMark, registerPerfMeta } from "@/perf/perf";

const work = createBackgroundWork({
  // The perf build's marks and React Native's startup timings use this clock too.
  now: () => performance.now(),
  schedule: (ms, run) => {
    const timer = setTimeout(run, ms);
    return () => clearTimeout(timer);
  },
});

// Back in the foreground, the owner is about to tap: work waits as after a touch. Gone to the
// background, no finger is on Wave, whatever touch end went unheard.
AppState.addEventListener("change", (state) => {
  if (state === "active") work.resumed();
  else work.touchEnded();
});

// Headless starts (Android Auto with no activity) report "background" too.
const backgrounded = () => AppState.currentState === "background";
const settledOrAway = openWhileBackgrounded(
  { settled: isScreenSettled, subscribe: onScreenSettled },
  {
    backgrounded,
    subscribe: (listener) => {
      const subscription = AppState.addEventListener("change", listener);
      return () => subscription.remove();
    },
  },
);

const startupWork = createStartupWork({
  now: () => performance.now(),
  intervalMs: () => {
    try {
      return WaveAppLog?.timingFrameIntervalMs?.() ?? 0;
    } catch {
      return 0;
    }
  },
  isSettled: isScreenSettled,
  backgrounded,
  subscribe: settledOrAway.subscribe,
  request: (run) => requestAnimationFrame(run),
  cancel: cancelAnimationFrame,
  whenFree: work.whenFree,
});
let startupStarted = 0;

/** Startup starts keep their registration order, after global settlement and quiet frames. */
export const afterFirstSettled = (name: string, start: () => void): (() => void) =>
  startupWork.whenFree(() => {
    startupStarted++;
    perfMark("startup.started", name);
    start();
  });

let contentSeen = false;

/** First-content perf milestone only. It never releases startup work. */
export const firstContentShown = (): void => {
  if (contentSeen) return;
  contentSeen = true;
  requestAnimationFrame(() => {
    perfMark("startup.content");
    work.contentShown();
  });
};

/** Runs [run] on the next free turn; returns the cancel. */
export const whenFree = (run: () => void): (() => void) => work.whenFree(run);

/** Resolves on the next free turn. */
export const freeTurn = (): Promise<void> => new Promise((resolve) => work.whenFree(resolve));

/** Waits for the next free turn; interrupted, it gives the turn up. */
export const freeTurnEffect: Effect.Effect<void> = Effect.callback<void>((resume) => {
  const cancel = work.whenFree(() => resume(Effect.void));
  return Effect.sync(cancel);
});

/** Startup jobs recheck global settlement/quietness at every resumable boundary. */
export const startupTurn = (): Promise<void> =>
  new Promise((resolve) => startupWork.whenFree(resolve));
export const startupTurnEffect: Effect.Effect<void> = Effect.callback<void>((resume) => {
  const cancel = startupWork.whenFree(() => resume(Effect.void));
  return Effect.sync(cancel);
});

/** The root view's touches, which background work waits out. */
export const touchStarted = (): void => work.touchStarted();
export const touchEnded = (event: GestureResponderEvent): void => {
  // Another finger still down keeps the touch going.
  if (event.nativeEvent.touches.length === 0) work.touchEnded();
};

/**
 * React Native cancels the root's touch when a native scroll or a gesture
 * handler takes it over, with the finger still down, and the lift then goes
 * unheard: background work goes on waiting, for Core's `takeoverMs` at most.
 */
export const touchTakenOver = (): void => work.touchTakenOver();

// A perf build's runs record when startup work went and how long slices waited.
registerPerfMeta("startup", () => {
  const stats = work.stats();
  return {
    contentAt: stats.contentAt === null ? null : Math.round(stats.contentAt),
    contentCapped: stats.contentCapped,
    startedPieces: startupStarted,
  };
});
registerPerfMeta("backgroundWork", () => {
  const { slices, longestWaitMs, forcedSlices } = work.stats();
  return { slices, longestWaitMs: Math.round(longestWaitMs), forcedSlices };
});

/** Optional CPU work starts only after the active transition settled, or with Wave in the background. */
export const settledTurnEffect = settledTurn({ ...settledOrAway, schedule: whenFree });
