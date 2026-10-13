import { settleSheet, stepNowPlayingSheet, type SheetEvent, type SheetPhase } from "@wave/core";
import { useSyncExternalStore } from "react";
import { Dimensions } from "react-native";
import { makeMutable, withSpring } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { makeExternalStore } from "@/lib/externalStore";

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

const runAfterClose = (): void => {
  const then = afterClose;
  afterClose = null;
  then?.();
};

const springDone = (): void => step({ type: "closed" });

const step = (event: SheetEvent, velocity = 0): void => {
  const next = stepNowPlayingSheet(phase.get(), event);
  phase.set(next.phase);
  switch (next.spring) {
    case "rise":
      sheetOffset.set(sheetHeight.get());
      sheetOffset.set(withSpring(0, SPRING));
      break;
    case "open":
      sheetOffset.set(withSpring(0, { ...SPRING, velocity }));
      break;
    case "closed":
      sheetOffset.set(
        withSpring(sheetHeight.get(), { ...SPRING, velocity }, (finished) => {
          if (finished === true) scheduleOnRN(springDone);
        }),
      );
      break;
    case null:
      break;
  }
  if (next.hidden) {
    for (const listener of hiddenListeners) listener();
    runAfterClose();
  }
};

/** Opens Now Playing from a tap: the sheet starts rising on the next frame. */
export const openNowPlaying = (): void => step({ type: "tap" });

/** A swipe up on the mini player has started: the sheet follows the finger. */
export const beginNowPlayingDrag = (): void => step({ type: "dragBegin" });

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
 * Dismisses Now Playing with its spring, then runs `then` (e.g. opening the
 * album); straight away when it is already out of sight.
 */
export const closeNowPlaying = (then?: () => void): void => {
  afterClose = then ?? null;
  step({ type: "close" });
  if (phase.get() === "hidden") runAfterClose();
};

/** The window changed size: keep a closed sheet just out of sight. */
export const resizeNowPlaying = (height: number): void => {
  sheetHeight.set(height);
  if (phase.get() === "hidden") sheetOffset.set(height);
};
