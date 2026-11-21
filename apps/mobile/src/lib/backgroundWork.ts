/**
 * Background work's turns (Core's `createBackgroundWork`, #315): startup
 * work (the scan, resumed imports, sync, priming playlists, resumed
 * downloads) waits until the first screen has globally settled and quiet frames have passed
 * (or, with Wave in the background, for free turns alone), and work in
 * slices (a scan's saves, a sync's database steps, a rescan on return) takes
 * each slice on a free turn, after the owner's touch and the motion it
 * started, never holding the JavaScript thread for a tap.
 */
import { createBackgroundWork, createJsBlockLog } from "@wave/core";
import * as Effect from "effect/Effect";
import { AppState, type GestureResponderEvent } from "react-native";

import { appLog } from "@/log/appLog";
import { isScreenSettled, onScreenSettled, onTimingTransition, timingRoute } from "./timing";
import { createStartupWork } from "./startupWork";
import { BackgroundWorkName, shareSlicesWith } from "./stepped";

import { WaveAppLog } from "@/native/waveAppLog";
import { openWhileBackgrounded, settledTurn } from "./settledWork";

import { perfMark, registerPerfMeta } from "@/perf/perf";

/**
 * A JS block over 50 ms while a screen is shown writes one app log line
 * naming the work (#1350): the slice or free turn it ran in, else none.
 */
const blocks = createJsBlockLog({
  write: (line) => appLog("warn", "WaveTiming", line),
  screen: () => (AppState.currentState === "active" ? timingRoute() : null),
});

const work = createBackgroundWork({
  // The perf build's marks and React Native's startup timings use this clock too.
  now: () => performance.now(),
  schedule: (ms, run) => {
    const timer = setTimeout(run, ms);
    return () => clearTimeout(timer);
  },
  sliceRan: blocks.sliceRan,
});

// Every stepped slice in the app runs here, within the scheduler's 8 ms.
shareSlicesWith(work.runSlice);

// A tap's transition holds every slice until it settles (or is cancelled by the next tap).
onTimingTransition((event) => {
  if (event.phase === "start") work.transitionStarted();
  else work.transitionEnded();
});

/** RN reports JS blocks over 50 ms as long tasks where it supports them; elsewhere, slices alone. */
type LongTask = { startTime: number; duration: number };
const Observer = (
  globalThis as {
    PerformanceObserver?: {
      new (callback: (list: { getEntries(): LongTask[] }) => void): {
        observe: (options: { type: string }) => void;
        disconnect: () => void;
      };
      supportedEntryTypes?: readonly string[];
    };
  }
).PerformanceObserver;
if (Observer?.supportedEntryTypes?.includes("longtask")) {
  const observer = new Observer((list) => {
    for (const entry of list.getEntries()) blocks.longTask(entry.startTime, entry.duration);
  });
  try {
    observer.observe({ type: "longtask" });
  } catch {
    observer.disconnect();
  }
}

/** Gives [name] its free turn, marked for the block log (what runs on it may be awaited code). */
const named = (name: string, run: () => void) => (): void => {
  blocks.turnTaken(name, performance.now());
  run();
};

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
  startupWork.whenFree(
    named(name, () => {
      startupStarted++;
      perfMark("startup.started", name);
      start();
    }),
  );

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

/** Runs [run], [name]'s work, on the next free turn; returns the cancel. */
export const whenFree = (run: () => void, name = "unnamed background work"): (() => void) =>
  work.whenFree(named(name, run));

/** Resolves on the next free turn, for [name]'s work. */
export const freeTurn = (name?: string): Promise<void> =>
  new Promise((resolve) => whenFree(resolve, name));

/** Waits for the next free turn, for the fiber's `BackgroundWorkName`; interrupted, it gives the turn up. */
export const freeTurnEffect: Effect.Effect<void> = Effect.flatMap(
  Effect.service(BackgroundWorkName),
  (name) =>
    Effect.callback<void>((resume) => {
      const cancel = whenFree(() => resume(Effect.void), name);
      return Effect.sync(cancel);
    }),
);

/** Startup jobs recheck global settlement/quietness at every resumable boundary. */
export const startupTurn = (name = "startup work"): Promise<void> =>
  new Promise((resolve) => startupWork.whenFree(named(name, resolve)));
export const startupTurnEffect: Effect.Effect<void> = Effect.flatMap(
  Effect.service(BackgroundWorkName),
  (name) =>
    Effect.callback<void>((resume) => {
      const cancel = startupWork.whenFree(named(name, () => resume(Effect.void)));
      return Effect.sync(cancel);
    }),
);

/** The gate frame-paced work (recommendations) shares: a tap's transition holds it. */
export const backgroundTransition = {
  inFlight: work.transitionInFlight,
  after: work.afterTransition,
};

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
  const { slices, longestWaitMs, forcedSlices, longestSliceMs, overBudget } = work.stats();
  return {
    slices,
    longestWaitMs: Math.round(longestWaitMs),
    forcedSlices,
    longestSliceMs: Math.round(longestSliceMs),
    // "scan 2, sync 1": the slices past 8 ms, by work (a step too long to split).
    overBudget: Object.entries(overBudget)
      .map(([name, count]) => `${name} ${count}`)
      .join(", "),
  };
});

/** Optional work waits for settlement (at most 3 s), then a free turn; backgrounding opens it early. */
export const settledTurnEffect = Effect.flatMap(Effect.service(BackgroundWorkName), (name) =>
  settledTurn({ ...settledOrAway, schedule: (run) => whenFree(run, name) }),
);
