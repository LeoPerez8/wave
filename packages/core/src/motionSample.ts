/**
 * Settings › Appearance › Motion's sample row (docs/spec.md, "Visual
 * design", Bounce amount): a fixed fake song, drawn like a song row, that
 * swipes as one does to show the bounce. It never touches the Library, and
 * letting it go runs nothing.
 */

import type { RowMenuAction, RowSwipeActions, SwipeSettings } from "./swipeActions.ts";

/**
 * What the sample row uncovers on each side under [settings]: the menu entry
 * each choice runs on a Library song with its file (Remove deletes it, the
 * star favorites it), so every choice shows, whatever a given song offers.
 * With swipes off it uncovers nothing: it still moves, to show the bounce.
 */
export const sampleSwipeActions = (settings: SwipeSettings): RowSwipeActions => {
  const action = (choice: SwipeSettings["right"]): RowMenuAction =>
    choice === "remove" ? "delete" : choice;
  return settings.enabled
    ? { right: action(settings.right), left: action(settings.left) }
    : { right: null, left: null };
};

/** One demo swipe: out [translationX] dp to the right over [outMs], then the row's own spring back. */
export interface BounceDemoSwipe {
  readonly translationX: number;
  readonly outMs: number;
}

/** The demo's reach, as a share of the row: short of the third where a swipe arms. */
const DEMO_REACH = 1 / 4;
const DEMO_OUT_MS = 240;

/**
 * The swipe the sample row plays by itself when the finger leaves the Bounce
 * amount slider, on a row [width] dp wide: a quarter of the row to the
 * right, never armed (no tick), and back on the row's spring at the new
 * amount. None under reduce motion (nothing replays) or before the row is
 * laid out (a width of 1 or less).
 */
export const bounceDemoSwipe = ({
  width,
  reduceMotion,
}: {
  readonly width: number;
  readonly reduceMotion: boolean;
}): BounceDemoSwipe | null =>
  reduceMotion || !(width > 1) ? null : { translationX: width * DEMO_REACH, outMs: DEMO_OUT_MS };
