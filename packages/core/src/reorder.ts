/**
 * Drag-to-reorder in a list of fixed-height rows (Up Next, playlist items):
 * where a dragged row would land if it were dropped now.
 *
 * Up Next runs these on the UI thread, inside Reanimated worklets, so a drag
 * keeps following the finger while JavaScript is busy: each starts with the
 * "worklet" directive (a plain string to Node and to every other caller).
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

/**
 * The index the dragged row would take: another row's place once its centre
 * passes that row's middle.
 */
export const reorderTarget = ({ from, distance, rowHeight, count }: ReorderDrag): number => {
  "worklet";
  return Math.max(0, Math.min(count - 1, from + Math.round(distance / rowHeight)));
};

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
  "worklet";
  if (from < to && index > from && index <= to) return -1;
  if (to < from && index >= to && index < from) return 1;
  return 0;
};

export interface ReorderEdge {
  /** The dragged row's top, from the list's top edge, in dp. */
  readonly top: number;
  readonly rowHeight: number;
  /** The list's visible height, in dp. */
  readonly viewport: number;
  /** How near the list's top or bottom edge the row starts scrolling it, in dp. */
  readonly edge: number;
  /** The speed with the row at or past an edge, in dp per second. */
  readonly maxSpeed: number;
}

/**
 * How fast a dragged row near the list's top or bottom edge scrolls it, in dp
 * per second (negative is up): faster the further into the edge it is, 0 away
 * from both edges.
 */
export const reorderScrollSpeed = ({
  top,
  rowHeight,
  viewport,
  edge,
  maxSpeed,
}: ReorderEdge): number => {
  "worklet";
  if (top < edge) return -maxSpeed * Math.min(1, (edge - top) / edge);
  const bottomGap = viewport - (top + rowHeight);
  if (bottomGap < edge) return maxSpeed * Math.min(1, (edge - bottomGap) / edge);
  return 0;
};
