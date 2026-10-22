/** Every-build timing adapter. No render counters, row observers or idle frame loop. */
import type { LostTapReason, TimingKind } from "@wave/core";
import { AppState, type GestureResponderEvent } from "react-native";

import { appLog, timingBuild } from "@/log/appLog";
import { onSlowLibraryRead } from "@/log/slowLibraryReads";
import { online } from "@/native/waveNative";

import { createLinkTapMonitor } from "./linkTapMonitor";
import { createTimingSession } from "./timingSession";

export type { TimingTransition } from "./timingSession";

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

let touchAt: number | undefined;
/** RN's native timestamps and performance.now share the monotonic clock on Android. */
export const timingTouch = (event: GestureResponderEvent): void => {
  const now = performance.now();
  const native = event.nativeEvent.timestamp;
  // Older RN's epoch timestamp must not produce a negative duration.
  touchAt = native <= now && now - native < 60_000 ? native : now;
};
export const hasTimingTouch = (): boolean => touchAt !== undefined;
const takeTouch = (): number => {
  const now = performance.now();
  const at = touchAt !== undefined && now - touchAt < 60_000 ? touchAt : now;
  touchAt = undefined;
  return at;
};

let surface: string | undefined;
export const setTimingSurface = (name: string | undefined): void => {
  surface = name;
};
export const beginTiming = (kind: TimingKind, to: string): number => {
  const id = session.begin(kind, to, takeTouch(), true, surface);
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
    touchAt === undefined
  ) {
    return kind === "choiceCard" ? session.reclassify(kind, to)! : active.id;
  }
  return beginTiming(kind, to);
};
export const activeTiming = session.active;
export const timingRoute = session.route;
export const timingResponse = session.response;
export const timingContent = session.content;
export const timingTransitionEnd = session.end;
export const onTimingTransition = session.onTransition;
export const onScreenSettled = session.onSettled;
export const isScreenSettled = session.isSettled;
export const noteTimingRead = session.read;
// Only slow reads call the subscriber; #581's two-timestamp fast path stays unchanged.
onSlowLibraryRead((read) => noteTimingRead(read.operation, read.durationMs));
export const noteTimingJsBlock = session.jsBlock;
export const noteTimingFrames = session.frames;
export const noteTimingHitch = session.hitch;
export const noteTimingLostTap = session.lost;

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
    session.leave();
    session.cancel();
    nativeTransitions.clear();
    touchAt = undefined;
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
if (Observer?.supportedEntryTypes?.includes("longtask")) {
  const observer = new Observer((list) => {
    for (const entry of list.getEntries()) session.jsBlock(entry.startTime, entry.duration);
  });
  try {
    observer.observe({ type: "longtask" });
  } catch {
    observer.disconnect();
  }
}
