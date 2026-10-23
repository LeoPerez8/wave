import {
  activeTiming,
  dismissTiming,
  noteTimingLinkClose,
  beginTiming,
  timingResponse,
  timingTransitionEnd,
  timingSurfaceCommitted,
  timingLinkNavigated,
  setTimingSurface,
} from "@/lib/timing";
import {
  settleSheet,
  stepNowPlayingSheet,
  type SheetEvent,
  type SheetPhase,
  type SheetStep,
} from "@wave/core";
import { useSyncExternalStore } from "react";
import { Dimensions } from "react-native";
import { makeMutable, withSpring } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { makeExternalStore } from "@/lib/externalStore";
import { dismissAllOverlays } from "@/overlay/overlay";
import { perfMark } from "@/perf/perf";

import { createLinkRevealCompletion, followNowPlayingLink } from "./linkClose";

/**
 * Now Playing is a sheet that stays mounted over the app (src/nowPlaying/
 * NowPlayingSheet.tsx), out of sight below the screen while it is closed. A
 * tap on the mini player only starts its spring, so it moves on the next
 * frame; a swipe up drags it under the finger. Core's `stepNowPlayingSheet`
 * decides where each event takes it.
 */

/** How far the sheet sits below its open position, in dp: 0 is open, `sheetHeight` is gone. */
export const sheetOffset = makeMutable(Dimensions.get("window").height);

/** The sheet's travel: the window height, kept current by the sheet. */
export const sheetHeight = makeMutable(Dimensions.get("window").height);

/** Quick, with a little give and no wobble. */
const SPRING = { damping: 30, stiffness: 300, mass: 1 } as const;

const phase = makeExternalStore<SheetPhase>("hidden");
const sheetSettled = makeExternalStore(false);
let motionDone = false;
let motionGeneration = 0;
let contentDrawn = false;
let sheetTimingId: number | undefined;
const linkReveal = createLinkRevealCompletion({
  committed: (id) => timingSurfaceCommitted(id, false),
  end: timingTransitionEnd,
  current: () => activeTiming()?.id,
  dismiss: dismissTiming,
});

/**
 * A cold artist lookup found its destination is the page already showing:
 * under this link's sheet close, or under the menu or swipe it was tapped in.
 */
export const revealNowPlayingLink = (id: number | undefined): void => {
  timingLinkNavigated(id);
  linkReveal.reveal(id);
};

/** A cold artist link opened nothing (an error shows instead): its timing ends unmeasured. */
export const failNowPlayingLink = (id: number | undefined): void => linkReveal.fail(id);
/** True only once the opening spring finished and the player content drew. */
export const useNowPlayingSettled = (): boolean =>
  useSyncExternalStore(sheetSettled.subscribe, sheetSettled.get);
export const isNowPlayingSettled = sheetSettled.get;
export const onNowPlayingSettledChange = sheetSettled.subscribe;
const updateSettled = (): void =>
  sheetSettled.set(motionDone && contentDrawn && phase.get() === "open");
const springOpened = (id: number | undefined, generation: number): void => {
  if (generation !== motionGeneration || id !== sheetTimingId) return;
  step({ type: "opened" });
  motionDone = true;
  if (id !== undefined) timingTransitionEnd(id);
  updateSettled();
};
/** Called after the player commit; a frame passes before its content is reported drawn. */
export const nowPlayingContentCommitted = (): void => {
  const id = sheetTimingId;
  const generation = motionGeneration;
  requestAnimationFrame(() => {
    if (generation !== motionGeneration || id !== sheetTimingId || !isNowPlayingShown()) return;
    if (id !== undefined) timingSurfaceCommitted(id, false);
    requestAnimationFrame(() => {
      if (generation !== motionGeneration || id !== sheetTimingId) return;
      contentDrawn = true;
      updateSettled();
    });
  });
};

let afterClose: (() => void) | null = null;

/** Whether Now Playing is on screen at all (open, opening, dragged or leaving). */
export const isNowPlayingShown = (): boolean => phase.get() !== "hidden";

/** `isNowPlayingShown`, re-rendering as it changes. */
export const useNowPlayingShown = (): boolean =>
  useSyncExternalStore(phase.subscribe, isNowPlayingShown);

/**
 * Calls `listener` with `isNowPlayingShown()` whenever the sheet moves
 * between phases (it may repeat a value); returns the unsubscribe.
 */
export const onNowPlayingShownChange = (listener: (shown: boolean) => void): (() => void) =>
  phase.subscribe(() => listener(isNowPlayingShown()));

/** Calls `listener` whenever the sheet has just gone out of sight. */
const hiddenListeners = new Set<() => void>();
export const onNowPlayingHidden = (listener: () => void): (() => void) => {
  hiddenListeners.add(listener);
  return () => hiddenListeners.delete(listener);
};

/** How many listeners follow the sheet's phase and its hiding (a perf build reports it). */
export const nowPlayingListenerCount = (): number => phase.listenerCount() + hiddenListeners.size;

const runAfterClose = (): void => {
  const then = afterClose;
  afterClose = null;
  then?.();
};

const springDone = (id: number | undefined, generation: number): void => {
  if (generation !== motionGeneration) return;
  if (id !== undefined) timingTransitionEnd(id);
  step({ type: "closed" });
};

/**
 * Takes the sheet through [event]. The spring is handed to the UI thread
 * first, then the phase's listeners hear of it (they re-render the sheet and
 * the chrome, pause the screens under it): however long they take, the sheet
 * is already moving.
 */
const step = (event: SheetEvent, velocity = 0): SheetStep => {
  const next = stepNowPlayingSheet(phase.get(), event);
  perfMark("nowPlaying.step", event.type);
  const timingId = sheetTimingId;
  if (next.spring !== null) {
    motionGeneration++;
    motionDone = false;
    sheetSettled.set(false);
  }
  const generation = motionGeneration;
  switch (next.spring) {
    case "rise":
      sheetOffset.set(sheetHeight.get());
      sheetOffset.set(
        withSpring(0, SPRING, (finished) => {
          if (finished) scheduleOnRN(springOpened, timingId, generation);
        }),
      );
      break;
    case "open":
      sheetOffset.set(
        withSpring(0, { ...SPRING, velocity }, (finished) => {
          if (finished) scheduleOnRN(springOpened, timingId, generation);
        }),
      );
      break;
    case "closed":
      sheetOffset.set(
        withSpring(sheetHeight.get(), { ...SPRING, velocity }, (finished) => {
          if (finished === true) scheduleOnRN(springDone, timingId, generation);
        }),
      );
      break;
    case null:
      break;
  }
  if (next.spring !== null) {
    perfMark("nowPlaying.spring", next.spring);
    if (timingId !== undefined) timingResponse(timingId);
  }
  // A card opened in Now Playing leaves with it rather than float over the app.
  if ((phase.get() === "open" || phase.get() === "opening") && next.phase === "closing")
    dismissAllOverlays();
  phase.set(next.phase);
  setTimingSurface(next.phase === "hidden" ? undefined : "Now Playing");
  if (next.spring === "rise" || next.spring === "open")
    requestAnimationFrame(nowPlayingContentCommitted);
  perfMark("nowPlaying.notified");
  if (next.hidden) {
    linkReveal.hidden();
    for (const listener of hiddenListeners) listener();
    runAfterClose();
  }
  return next;
};

/** Opens Now Playing from a tap: the sheet starts rising on the next frame. */
export const openNowPlaying = (): void => {
  if (phase.get() === "hidden" || phase.get() === "closing") {
    sheetTimingId = beginTiming("nowPlayingOpen", "Now Playing");
    contentDrawn = false;
    sheetSettled.set(false);
  }
  step({ type: "tap" });
};

/** A swipe up on the mini player has started: the sheet follows the finger. */
export const beginNowPlayingDrag = (): void => {
  step({ type: "dragBegin" });
};

/**
 * The swipe up ended `translationY` dp from where it started (negative is up):
 * open the sheet or let it fall back.
 */
export const endNowPlayingDrag = (translationY: number, velocityY: number): void => {
  if (phase.get() !== "drag") return;
  const height = sheetHeight.get();
  const offset = Math.min(height, Math.max(0, height + translationY));
  const to = settleSheet({ from: "closed", offset, velocity: velocityY, height });
  step({ type: "release", to }, velocityY);
};

/** A drag down on the open sheet let go `offset` dp below open: dismiss it or spring back. */
export const releaseNowPlaying = (offset: number, velocity: number): void => {
  const to = settleSheet({ from: "open", offset, velocity, height: sheetHeight.get() });
  step({ type: "release", to }, velocity);
};

/**
 * Dismisses Now Playing with its spring, then runs any completion work;
 * straight away when it is already out of sight. Links use link-close instead.
 */
export const closeNowPlaying = (then?: () => void, source?: "Back" | "chevron" | "card"): void => {
  if (source !== undefined) noteTimingLinkClose(source);
  afterClose = then ?? null;
  if (
    isNowPlayingShown() &&
    then === undefined &&
    !["artistLink", "albumLink", "goToArtist"].includes(activeTiming()?.kind ?? "")
  ) {
    sheetTimingId = beginTiming("nowPlayingClose", "Now Playing closed");
    timingSurfaceCommitted(sheetTimingId, false);
  }
  sheetSettled.set(false);
  step({ type: "close" });
  if (phase.get() === "hidden") runAfterClose();
};

/** A link owns its navigation now, independently of the closing spring or later closes. */
export const closeNowPlayingForLink = (navigate: () => void): void => {
  sheetSettled.set(false);
  linkReveal.begin(activeTiming()?.id);
  // The sheet's spring must not end the pushed screen's timing window.
  sheetTimingId = undefined;
  followNowPlayingLink({ step, navigate });
  if (!isNowPlayingShown()) linkReveal.hidden();
};

/** The window changed size: keep a closed sheet just out of sight. */
export const resizeNowPlaying = (height: number): void => {
  sheetHeight.set(height);
  if (phase.get() === "hidden") sheetOffset.set(height);
};
