/**
 * Wave's toast: a line on a small glass pill at the top of the screen, just
 * under the status bar, that goes away on its own, or sooner on a tap or a
 * swipe up. Decide how long it stays and which swipes send it away.
 */

import { resolveSkipSwipe } from "./swipe.ts";

/** How long a short line stays up, in ms. */
const SHORT_MS = 4_000;

/** A line up to this long is short. */
const SHORT_CHARACTERS = 40;

/** Reading time added for each character past a short line, in ms. */
const MS_PER_CHARACTER = 50;

/** Time added for an action on the pill (Undo), to reach it, in ms. */
const ACTION_MS = 2_000;

/** The longest any line stays up, in ms. */
const LONGEST_MS = 8_000;

/**
 * How long [text] stays up, in ms: a few seconds, more for a longer line or
 * one [withAction] (Undo). The app lengthens it further when Android's
 * accessibility timeout asks to.
 */
export const toastDuration = (
  text: string,
  { withAction = false }: { readonly withAction?: boolean } = {},
): number =>
  Math.min(
    LONGEST_MS,
    SHORT_MS +
      Math.max(0, text.length - SHORT_CHARACTERS) * MS_PER_CHARACTER +
      (withAction ? ACTION_MS : 0),
  );

/** How a drag on the toast ended. */
export interface ToastSwipe {
  /** Distance dragged, in dp; negative is left. */
  readonly translationX: number;
  /** Distance dragged, in dp; negative is up. */
  readonly translationY: number;
  /** Speed when the finger lifted, in dp/s; negative is left. */
  readonly velocityX: number;
  /** Speed when the finger lifted, in dp/s; negative is up. */
  readonly velocityY: number;
  /** Size of the toast, in dp. */
  readonly width: number;
  readonly height: number;
}

/**
 * Whether a finished drag sends the toast away; otherwise it settles back.
 * Up, off the top of the screen, with the mini player's thresholds (a third
 * of the way, or a flick).
 */
export const toastSwipeDismisses = ({ translationY, velocityY, height }: ToastSwipe): boolean =>
  // Up is "next" on the mini player's axis, where negative is left.
  resolveSkipSwipe({ translationX: translationY, velocityX: velocityY, width: height }) === "next";
