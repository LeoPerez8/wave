/** Every-build timing adapter. No render counters, row observers or idle frame loop. */
import {
  missedFramesLine,
  type TimingFrames,
  type LostTapReason,
  type TimingKind,
} from "@wave/core";
import { AppState, type GestureResponderEvent } from "react-native";

import { appLog, timingBuild } from "@/log/appLog";
import { onSlowLibraryRead } from "@/log/slowLibraryReads";
import { WaveAppLog } from "@/native/waveAppLog";
import { online } from "@/native/waveNative";

import { createTransitionFrames } from "./transitionFrames";
import { createLinkTapMonitor } from "./linkTapMonitor";
import { createTimingSession } from "./timingSession";

const background = new Map<string, () => string | null>();
const session = createTimingSession({
  now: () => performance.now(),
  wallNow: Date.now,
  write: (line) => appLog("info", "WaveTiming", line),
  context: () => ({
    background: [...background.values()].flatMap((read) => read() ?? []),
    offline: !online(),
  }),
  build: timingBuild,
});

const linkTaps = createLinkTapMonitor({
  later: (callback, ms) => setTimeout(callback, ms),
  cancel: (timer) => clearTimeout(timer),
  lost: (line) => {
    session.lost();
    appLog("warn", "WaveTiming", line);
  },
});
export const timingLinkNavigated = (id: number | undefined): void => {
  if (id !== undefined) linkTaps.navigated(id);
};
export const noteTimingLinkFailure = (id: number, reason: LostTapReason): void =>
  linkTaps.reason(id, reason);
export const noteTimingLinkClose = linkTaps.closeTakenOver;

/** Register cheap existing state; never read the database to explain a slow tap. */
export const registerTimingBackground = (name: string, read: () => string | null): void => {
  background.set(name, read);
};
/** A work item starting/ending in the timing window is retained even when it ends before settlement. */
export const timingBackgroundChanged = (): void => session.backgroundChanged();

/** RN's native timestamps and performance.now share the monotonic clock on Android. */
export const timingTouch = (event: GestureResponderEvent): void =>
  session.touch(event.nativeEvent.timestamp);
export const timingTouchEnded = (event: GestureResponderEvent): void => {
  // Another finger still down keeps the touch going.
  if (event.nativeEvent.touches.length === 0) session.touchEnded();
};
/** A native scroll or gesture took the touch over: its lift goes unheard, so this is its end. */
export const timingTouchTakenOver = session.touchEnded;
export const hasTimingTouch = session.hasTouch;

let surface: string | undefined;
export const setTimingSurface = (name: string | undefined): void => {
  surface = name;
};
export const beginTiming = (kind: TimingKind, to: string): number => {
  const id = session.beginTouched(kind, to, surface);
  if (surface === "Now Playing" && (kind === "artistLink" || kind === "albumLink"))
    linkTaps.begin(id, { kind, from: surface, to });
  return id;
};
/** A resolved link/choice continues its original touch window. */
export const continueTiming = (
  kind: "artistLink" | "albumLink" | "goToArtist" | "choiceCard",
  to: string,
): number => {
  const active = session.active();
  if (
    active !== null &&
    ["artistLink", "albumLink", "goToArtist", "choiceCard"].includes(active.kind) &&
    !session.hasTouch()
  ) {
    return kind === "choiceCard" ? session.reclassify(kind, to)! : active.id;
  }
  return beginTiming(kind, to);
};
export const activeTiming = session.active;
export const timingResponse = session.response;
export const timingContent = session.content;
export const timingTransitionEnd = session.end;
/** A tap that opened nothing (an error instead): ends unmeasured, and the screen settles again. */
export const dismissTiming = session.dismiss;
export const onScreenSettled = session.onSettled;
export const isScreenSettled = session.isSettled;
const noteTimingRead = session.read;
// Only slow reads call the subscriber; #581's two-timestamp fast path stays unchanged.
onSlowLibraryRead((read) => noteTimingRead(read.operation, read.durationMs));

/** The commit is timestamped in a layout effect; its first frame is a single rAF. */
export const timingRouteCommitted = (path: string): void => {
  const cold = session.active() === null;
  const id = session.routeCommitted(path);
  if (id === null) return;
  requestAnimationFrame(() => {
    session.frame(id);
    if (cold) session.end(id);
  });
};

/** A screen's mount/focus commit, also for two pushes to the same pathname. */
export const timingScreenCommitted = (): void => {
  const active = session.active();
  if (
    active === null ||
    active.kind === "tab" ||
    ["nowPlayingOpen", "nowPlayingClose", "queue", "choiceCard"].includes(active.kind)
  )
    return;
  session.response(active.id);
  requestAnimationFrame(() => session.frame(active.id));
};

/** A non-router surface (Queue, card, sheet): its commit, next frame and content. */
export const timingSurfaceCommitted = (id: number, ends = true): void => {
  session.response(id);
  requestAnimationFrame(() => {
    session.frame(id);
    session.content(id);
    if (ends) session.end(id);
  });
};

/** Called in each native stack's screenListeners, including hardware and gesture pops. */
const nativeTransitions = new Map<string, number>();
export const timingStackListeners = {
  transitionStart: (event: { target?: string; data: { closing: boolean } }): void => {
    let active = session.active();
    if (active === null && event.data.closing) {
      beginTiming("pop", "Back");
      active = session.active();
    }
    if (active !== null && event.target !== undefined)
      nativeTransitions.set(event.target, active.id);
  },
  transitionEnd: (event: { target?: string }): void => {
    if (event.target === undefined) return;
    const id = nativeTransitions.get(event.target);
    nativeTransitions.delete(event.target);
    if (id !== undefined && ![...nativeTransitions.values()].includes(id)) session.end(id);
  },
};

// Cancelling a transition also stops #582's frame counters. Backgrounding never pretends it settled.
let appState = AppState.currentState ?? "active";
AppState.addEventListener("change", (state) => {
  if (state !== "active" && appState === "active") {
    for (const hitch of WaveAppLog?.takeTimingHitches?.() ?? []) session.hitch(hitch);
    session.cancel();
    // A settled UI result may still be crossing the bridge. Include it before resetting the window.
    if (frameCollection === null) session.leave();
    else void frameCollection.flush().then(() => session.leave());
    nativeTransitions.clear();
    session.forgetTouch();
  }
  if (state === "active" && appState !== "active") timingRouteCommitted(session.route());
  appState = state;
});

/** RN reports actual JS blocks when supported; absent support is not a measured zero. */
type LongTask = { startTime: number; duration: number };
type LongTaskObserver = { observe: (options: { type: string }) => void; disconnect: () => void };
const Observer = (
  globalThis as {
    PerformanceObserver?: {
      new (callback: (list: { getEntries(): LongTask[] }) => void): LongTaskObserver;
      supportedEntryTypes?: readonly string[];
    };
  }
).PerformanceObserver;
const observeTransitionTasks = (): (() => void) => {
  if (!Observer?.supportedEntryTypes?.includes("longtask")) return () => {};
  const observer = new Observer((list) => {
    for (const entry of list.getEntries()) session.jsBlock(entry.startTime, entry.duration);
  });
  try {
    observer.observe({ type: "longtask" });
  } catch {
    observer.disconnect();
  }
  return () => observer.disconnect();
};

let frameCollection: ReturnType<typeof createTransitionFrames> | null = null;
/** Root lifetime only. The subscription is idle; callbacks and long-task observation are tap-scoped. */
export const startTimingFrameCollection = (): (() => void) => {
  const frames = createTransitionFrames({
    now: () => performance.now(),
    request: (callback) => requestAnimationFrame(callback),
    cancel: cancelAnimationFrame,
    // Refresh rate can change during a transition. Unknown support is not measured as 60 Hz.
    intervalMs: () => {
      try {
        return WaveAppLog?.timingFrameIntervalMs?.() ?? 0;
      } catch {
        return 0;
      }
    },
    uiStart: (id, age) => {
      try {
        WaveAppLog?.startTimingFrames?.(id, age);
      } catch {
        /* Runtime teardown. */
      }
    },
    uiStop: (id) => {
      const native = WaveAppLog;
      if (native?.stopTimingFrames === undefined) return Promise.resolve(null);
      return new Promise<TimingFrames | null>((resolve) => {
        const stop = (totals: TimingFrames | null) => {
          clearTimeout(timeout);
          listener.remove();
          resolve(totals);
        };
        const listener = native.addListener("timingFrames", (event) => {
          if (event.id === id) stop(event.measured ? event : null);
        });
        // Runtime teardown may prevent a native answer. This timer exists only during handoff.
        const timeout = setTimeout(() => stop(null), 5000);
        try {
          native.stopTimingFrames!(id);
        } catch {
          stop(null);
        }
      });
    },
    observe: observeTransitionTasks,
    report: (event, lane, totals) => {
      session.frames(event.id, totals.count);
      const line = missedFramesLine(event, lane, totals);
      if (line !== null) appLog("info", "WaveTiming", line);
    },
  });
  frameCollection = frames;
  const unsubscribe = session.onTransition(frames.transition);
  return () => {
    unsubscribe();
    frames.dispose();
    if (frameCollection === frames) frameCollection = null;
  };
};
