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
