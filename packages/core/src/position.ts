/**
 * Where the playhead is between the player's position reports, for the
 * Now Playing scrubber and the elapsed / remaining labels.
 */

/** The player's last word on the position. */
export interface PositionReport {
  readonly positionMs: number;
  readonly durationMs: number | null;
  /** Wall-clock time (ms) the position was read at. */
  readonly at: number;
  readonly isPlaying: boolean;
}

/** The position at wall-clock time `now`, running on from the last report while playing. */
export const extrapolatePosition = (report: PositionReport, now: number): number => {
  "worklet";
  const elapsed = report.isPlaying ? Math.max(0, now - report.at) : 0;
  const position = report.positionMs + elapsed;
  return report.durationMs === null ? position : Math.min(position, report.durationMs);
};

export interface ScrubTouch {
  /** Distance of the finger from the bar's left end, in dp. */
  readonly x: number;
  /** Width of the bar, in dp. */
  readonly width: number;
  readonly durationMs: number;
}

/** The position a finger on the scrubber points at. Runs on the UI thread too (a worklet). */
export const scrubPosition = ({ x, width, durationMs }: ScrubTouch): number => {
  "worklet";
  if (width <= 0) return 0;
  return Math.min(1, Math.max(0, x / width)) * durationMs;
};

/** How far from the bar's centre a touch still grabs the scrubber, in dp: a 56 dp tall grab area. */
const SCRUB_REACH = 28;

/** Extra touch area above and below a box, in dp (a gesture's hit slop). */
export interface VerticalSlop {
  readonly top: number;
  readonly bottom: number;
}

/**
 * The hit slop that stretches the scrubber's touch box, `height` dp tall and
 * centred on the bar, to reach `SCRUB_REACH` either side of the bar's centre.
 * The extra area lies outside the layout, so nothing around the bar moves;
 * a box that already reaches that far keeps its own area.
 */
export const scrubHitSlop = (height: number): VerticalSlop => {
  const grow = Math.max(0, SCRUB_REACH - height / 2);
  return { top: grow, bottom: grow };
};
