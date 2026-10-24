/**
 * What a tap on Now Playing's cover does (docs/spec.md, Mini player and Now
 * Playing): a tap plays or pauses, a double-tap adds the song to Favorites.
 */

/**
 * How long after a tap a second one still makes a double-tap, in
 * milliseconds: Android's own double-tap timeout, so a single tap waits only
 * as long as the system's double-taps take.
 */
export const DOUBLE_TAP_MS = 300;

export interface CoverTaps {
  /** A finger tapped the cover (lifted from it). */
  readonly tap: () => void;
  /** Forgets a tap still waiting to be told apart (the cover went away). */
  readonly cancel: () => void;
}

/**
 * Tells the cover's taps apart: a tap with no second one within
 * `DOUBLE_TAP_MS` is a tap ([onTap], once the wait is over); a second tap
 * within it makes a double-tap ([onDoubleTap], at once). Taps going on
 * within `DOUBLE_TAP_MS` of each other after a double-tap are double-taps
 * too, so a third tap doesn't pause the song.
 */
export const createCoverTaps = (options: {
  /** Calls [run] in [ms]; returns how to cancel it. */
  readonly schedule: (ms: number, run: () => void) => () => void;
  readonly onTap: () => void;
  readonly onDoubleTap: () => void;
}): CoverTaps => {
  const { schedule, onTap, onDoubleTap } = options;
  /** What the wait under way is for: a first tap to settle, or the taps after a double-tap to stop. */
  let waiting: "tap" | "doubleTap" | null = null;
  let cancelWait: (() => void) | null = null;

  const cancel = (): void => {
    cancelWait?.();
    cancelWait = null;
    waiting = null;
  };

  const wait = (kind: "tap" | "doubleTap"): void => {
    waiting = kind;
    cancelWait = schedule(DOUBLE_TAP_MS, () => {
      cancelWait = null;
      waiting = null;
      if (kind === "tap") onTap();
    });
  };

  const tap = (): void => {
    const pending = waiting;
    cancel();
    if (pending === null) {
      wait("tap");
      return;
    }
    // A tap soon after a double-tap is one more: it never plays or pauses by surprise.
    onDoubleTap();
    wait("doubleTap");
  };

  return { tap, cancel };
};

/**
 * What a double-tap on the cover does: `favorite` adds the song to Favorites
 * and shows the star; `star` only shows the star (the song is in
 * Favorites already: a double-tap never takes it out); `none` does nothing,
 * so the star never shows for a favorite that wasn't made.
 */
export type CoverDoubleTap = "favorite" | "star" | "none";

/**
 * What a double-tap on the cover does for the song playing, given whether
 * it's [starred] and whether it can be starred yet ([canStar]: false with
 * nothing playing, and for a streamed song until the Library's first read,
 * as Now Playing's star waits).
 */
export const coverDoubleTap = (song: {
  readonly starred: boolean;
  readonly canStar: boolean;
}): CoverDoubleTap => {
  if (song.starred) return "star";
  return song.canStar ? "favorite" : "none";
};
