/**
 * Gestures on list rows: dragging a row to a new place (playlist items) and
 * swiping one away to remove it.
 */

import { resolveSkipSwipe, type SkipSwipe } from "./swipe.ts";

/**
 * Whether a finished horizontal swipe on a row removes it: leftwards only,
 * with the mini player's distance and flick rules, so every swipe in Wave
 * commits at the same point.
 */
export const resolveRemoveSwipe = (swipe: SkipSwipe): boolean => resolveSkipSwipe(swipe) === "next";

export interface RowDrag {
  /** Where the dragged row started (0-based). */
  readonly from: number;
  /** How far the row has been dragged, scrolling included, in dp; negative is up. */
  readonly offsetY: number;
  /** Height of every row, in dp (rows are fixed-height). */
  readonly rowHeight: number;
  /** Number of rows in the list. */
  readonly count: number;
}

/**
 * The index a dragged row would land at if dropped now: it takes another row's
 * place once its centre passes that row's middle.
 */
export const dragTargetIndex = ({ from, offsetY, rowHeight, count }: RowDrag): number =>
  Math.min(count - 1, Math.max(0, from + Math.round(offsetY / rowHeight)));
