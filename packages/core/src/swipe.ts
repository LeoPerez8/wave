/**
 * Swipe-to-skip on the mini player: when a horizontal drag ends, decide
 * whether it skips. Left goes to the next track, right to the previous one,
 * like turning a page.
 */

import type { NowPlayingScreen } from "./nowPlayingScreens.ts";

export type SkipDirection = "next" | "previous";

export interface SkipSwipe {
  /** Horizontal distance dragged, in dp; negative is left. */
  readonly translationX: number;
  /** Horizontal speed when the finger lifted, in dp/s; negative is left. */
  readonly velocityX: number;
  /** Width of the swiped surface, in dp. */
  readonly width: number;
}

/** A drag this far across the surface skips however slowly it ends. */
const DISTANCE_FRACTION = 1 / 3;

/** A flick at least this fast skips even when it is short, in dp/s. */
const FLICK_VELOCITY = 600;

/** A flick still has to travel this far, so a tremor on a tap doesn't skip, in dp. */
const FLICK_MIN_DISTANCE = 16;

/**
 * Returns the skip a finished drag asks for, or `null` to settle back. A flick
 * back against the drag cancels it, even past the distance.
 */
export const resolveSkipSwipe = ({
  translationX,
  velocityX,
  width,
}: SkipSwipe): SkipDirection | null => {
  const distance = Math.abs(translationX);
  const fast = Math.abs(velocityX) >= FLICK_VELOCITY;
  const sameWay = Math.sign(velocityX) === Math.sign(translationX);
  if (fast && !sameWay) return null;
  const far = distance >= width * DISTANCE_FRACTION;
  const flick = fast && distance >= FLICK_MIN_DISTANCE;
  if (!far && !flick) return null;
  return translationX < 0 ? "next" : "previous";
};

/** A swipe between Now Playing's screens, let go. */
export interface ScreenSwipe extends SkipSwipe {
  /** The screen the drag started on. */
  readonly from: NowPlayingScreen;
}

/**
 * Returns the screen a finished swipe settles on. The Queue sits to the
 * player's right, so a drag left turns to it and a drag right returns, by the
 * travel and speed that skip a song on the mini player; anything else settles
 * back where it started.
 */
export const settleScreenSwipe = ({ from, ...swipe }: ScreenSwipe): NowPlayingScreen => {
  const turn = resolveSkipSwipe(swipe);
  if (from === "player") return turn === "next" ? "queue" : "player";
  return turn === "previous" ? "player" : "queue";
};
