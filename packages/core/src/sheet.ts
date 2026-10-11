/**
 * The Now Playing sheet follows the finger: swiped up from the mini player to
 * open, dragged down to dismiss. When the finger lifts, decide where it settles.
 */

export type SheetState = "open" | "closed";

export interface SheetDrag {
  /** Where the drag started. */
  readonly from: SheetState;
  /** How far the sheet sits below its open position when the finger lifts, in dp. */
  readonly offset: number;
  /** Vertical speed when the finger lifted, in dp/s; positive is down. */
  readonly velocity: number;
  /** The sheet's full travel (the screen height), in dp. */
  readonly height: number;
}

/** A drag this far toward the other state commits to it however slowly it ends. */
const DISTANCE_FRACTION = 1 / 4;

/** A flick at least this fast commits even when it is short, in dp/s. */
const FLICK_VELOCITY = 800;

/** A flick still has to travel this far, so a tremor on a tap doesn't count, in dp. */
const FLICK_MIN_DISTANCE = 16;

/**
 * Where the sheet comes to rest. A flick back toward where the drag started
 * cancels it, even past the distance.
 */
export const settleSheet = ({ from, offset, velocity, height }: SheetDrag): SheetState => {
  const other: SheetState = from === "open" ? "closed" : "open";
  // Distance and speed toward the other state.
  const travel = from === "open" ? offset : height - offset;
  const speed = from === "open" ? velocity : -velocity;
  if (speed <= -FLICK_VELOCITY) return from;
  const far = travel >= height * DISTANCE_FRACTION;
  const flick = speed >= FLICK_VELOCITY && travel >= FLICK_MIN_DISTANCE;
  return far || flick ? other : from;
};
