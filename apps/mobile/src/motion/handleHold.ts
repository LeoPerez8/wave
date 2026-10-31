/**
 * What every drag handle's pan starts with, so a swipe that begins on a handle
 * scrolls the list. A finger still for 150 ms lifts the row, on the UI thread;
 * one that moves past the touch slop before then fails the pan, and the touch
 * stays with whatever is under the handle. The Long-press delay setting doesn't
 * change this: it's for opening menus.
 *
 * Only the hold may activate the pan. On Android, Gesture Handler checks
 * `minDistance` during the wait as well: 0 lifts on the first move, and the
 * default (the touch slop) lifts a swipe that lands exactly on the slop.
 */
export const handleHold = {
  activateAfterLongPress: 150,
  minDistance: 1_000_000,
} as const;

/**
 * The hit slop of a row's swipe, for a row with a handle [width] wide at its
 * end (0 with none showing). The handle's pan fails on an early move, so a
 * sideways swipe from the handle would otherwise run the row's action, which
 * can be Remove from Playlist. Only where the touch lands counts: a swipe that
 * starts on the rest of the row goes on over the handle.
 */
export const handleSwipeSlop = (width: number): { readonly right: number } => ({ right: -width });
