/**
 * Drag-to-reorder in a list of fixed-height rows (Up Next): where a dragged
 * row would land if it were dropped now.
 */

export interface ReorderDrag {
  /** The dragged row's index when the drag started. */
  readonly from: number;
  /** How far the row has moved through the list (finger travel plus any auto-scroll), in dp; negative is up. */
  readonly distance: number;
  readonly rowHeight: number;
  /** Rows in the list. */
  readonly count: number;
}

/** The index the dragged row would take. */
export const reorderTarget = ({ from, distance, rowHeight, count }: ReorderDrag): number =>
  Math.max(0, Math.min(count - 1, from + Math.round(distance / rowHeight)));

export interface ReorderRow {
  readonly index: number;
  /** Where the dragged row came from. */
  readonly from: number;
  /** Where the dragged row would land. */
  readonly to: number;
}

/**
 * How many places a row steps aside to make room for the dragged one: -1 (up),
 * 1 (down) or 0. The dragged row itself follows the finger, so it is 0.
 */
export const reorderShift = ({ index, from, to }: ReorderRow): number => {
  if (from < to && index > from && index <= to) return -1;
  if (to < from && index >= to && index < from) return 1;
  return 0;
};
