import { settleSheet, type SheetState } from "@wave/core";
import { router, type Href } from "expo-router";
import { Dimensions } from "react-native";
import { makeMutable, withSpring } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

/**
 * Now Playing is a route (`/now-playing`) presented as a transparent modal
 * over the tabs, and moves as a sheet: it follows the finger up from the mini
 * player and down to dismiss, and springs to wherever it settles. Its
 * position lives here so the mini player's swipe can drive a sheet that is
 * still mounting.
 */

/** How far the sheet sits below its open position, in dp: 0 is open, `sheetHeight` is gone. */
export const sheetOffset = makeMutable(Dimensions.get("window").height);

/** The sheet's travel: the window height, kept current by the screen. */
export const sheetHeight = makeMutable(Dimensions.get("window").height);

/** Quick, with a little give and no wobble. */
const SPRING = { damping: 30, stiffness: 300, mass: 1 } as const;

/**
 * What the sheet is doing: rising or resting open, following a swipe up from
 * the mini player, or leaving. `idle` until the route is presented.
 */
let intent: "idle" | "open" | "drag" | "closed" = "idle";
let mounted = false;
let afterClose: (() => void) | null = null;

/** Pops the route once the sheet is out of sight (or as soon as the screen has mounted). */
const pop = (): void => {
  if (intent !== "closed" || !mounted) return;
  intent = "idle";
  const then = afterClose;
  afterClose = null;
  router.back();
  then?.();
};

/** Springs the sheet open or away (then pops the route), carrying the finger's speed. */
export const settleNowPlaying = (state: SheetState, velocity = 0): void => {
  intent = state;
  if (state === "open") {
    sheetOffset.set(withSpring(0, { ...SPRING, velocity }));
    return;
  }
  sheetOffset.set(
    withSpring(sheetHeight.get(), { ...SPRING, velocity }, (finished) => {
      if (finished === true) scheduleOnRN(pop);
    }),
  );
};

const present = (next: "open" | "drag"): void => {
  if (intent !== "idle") return;
  intent = next;
  // A swipe is already moving the sheet; a tap starts it out of sight.
  if (next === "open") sheetOffset.set(sheetHeight.get());
  router.push("/now-playing");
};

/** Opens Now Playing from a tap: the sheet rises on its own once it mounts. */
export const openNowPlaying = (): void => present("open");

/** A swipe up on the mini player has started: present the sheet under the finger. */
export const beginNowPlayingDrag = (): void => present("drag");

/**
 * The swipe up ended `translationY` dp from where it started (negative is up):
 * open the sheet or let it fall back.
 */
export const endNowPlayingDrag = (translationY: number, velocityY: number): void => {
  if (intent !== "drag") return;
  const height = sheetHeight.get();
  const offset = Math.min(height, Math.max(0, height + translationY));
  settleNowPlaying(settleSheet({ from: "closed", offset, velocity: velocityY, height }), velocityY);
};

/** Whether the mini player's swipe should move the sheet. */
export const isDraggingNowPlaying = (): boolean => intent === "drag";

/** Dismisses Now Playing with its spring, then runs `then` (e.g. opening the album). */
export const closeNowPlaying = (then?: () => void): void => {
  afterClose = then ?? null;
  settleNowPlaying("closed");
};

/** Dismisses Now Playing and opens a screen (an album, an artist) in its place. */
export const closeNowPlayingTo = (href: Href): void => closeNowPlaying(() => router.push(href));

/**
 * Called by the screen as it mounts; returns its unmount cleanup. A sheet
 * opened by a link (or restored by the system) rises like a tapped one.
 */
export const nowPlayingMounted = (): (() => void) => {
  mounted = true;
  if (intent === "idle") {
    intent = "open";
    sheetOffset.set(sheetHeight.get());
  }
  if (intent === "open") settleNowPlaying("open");
  // A flick down that ended before the screen mounted: the spring may already be done.
  if (intent === "closed" && sheetOffset.get() >= sheetHeight.get()) pop();
  return () => {
    mounted = false;
    intent = "idle";
    afterClose = null;
    sheetOffset.set(sheetHeight.get());
  };
};
