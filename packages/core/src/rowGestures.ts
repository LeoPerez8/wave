/**
 * Gestures on list rows: swiping a song row sideways to run an action
 * (`rowSwipeActions` decides which). Dragging a row to a new place is
 * `reorderTarget` (reorder.ts), shared with Up Next.
 */

import type { SkipSwipe } from "./swipe.ts";

/** The side a row is swiped towards: right uncovers the left edge, left the right one. */
export type RowSwipeSide = "left" | "right";

/** Which sides a row has an action for: it doesn't move towards the others. */
export interface RowSwipeSides {
  readonly left: boolean;
  readonly right: boolean;
}

/**
 * A flick back against the drag at least this fast cancels it, as on the
 * mini player, in dp/s.
 */
const FLICK_BACK_VELOCITY = 600;

/**
 * The side a row dragged [translationX] dp (negative is left) is armed
 * towards: past a third of its [width], or null before. Crossing it is the
 * moment the row ticks. Runs on the UI thread while the row is dragged.
 */
export const rowSwipeArmed = ({
  translationX,
  width,
}: Pick<SkipSwipe, "translationX" | "width">): RowSwipeSide | null => {
  "worklet";
  if (Math.abs(translationX) < width / 3) return null;
  return translationX < 0 ? "left" : "right";
};

/**
 * The side whose action a finished swipe runs, or null to spring back: it
 * runs when the finger lifts with the row armed (`rowSwipeArmed`) towards a
 * side it has an action for ([sides]), unless it was flicked back against
 * the drag. A short swipe springs back however fast it ends, so nothing runs
 * that the row didn't show armed.
 */
export const resolveRowSwipe = (
  { translationX, velocityX, width }: SkipSwipe,
  sides: RowSwipeSides,
): RowSwipeSide | null => {
  const armed = rowSwipeArmed({ translationX, width });
  if (armed === null || !sides[armed]) return null;
  const flickedBack =
    Math.abs(velocityX) >= FLICK_BACK_VELOCITY && Math.sign(velocityX) !== Math.sign(translationX);
  return flickedBack ? null : armed;
};
