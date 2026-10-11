/**
 * Gestures on list rows: swiping one away to remove it. Dragging a row to a
 * new place is `reorderTarget` (reorder.ts), shared with Up Next.
 */

import { resolveSkipSwipe, type SkipSwipe } from "./swipe.ts";

/**
 * Whether a finished horizontal swipe on a row removes it: leftwards only,
 * with the mini player's distance and flick rules, so every swipe in Wave
 * commits at the same point.
 */
export const resolveRemoveSwipe = (swipe: SkipSwipe): boolean => resolveSkipSwipe(swipe) === "next";
