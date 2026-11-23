/**
 * Holding Now Playing's Next or Previous: the song jumps 5 seconds forward or
 * back as the long press is recognised, then again every `HOLD_SKIP_REPEAT_MS`
 * while the finger stays down, and a label above the button shows the total
 * moved so far. Story 38d.
 */

/** How far one jump moves the song. */
export const HOLD_SKIP_STEP_MS = 5_000;

/** How long a held button waits between one jump and the next. */
export const HOLD_SKIP_REPEAT_MS = 500;

export type HoldSkipDirection = "forward" | "back";

/** Where the song is as a jump starts; the length is null while it's unknown. */
export interface HoldSkipFrom {
  readonly positionMs: number;
  readonly durationMs: number | null;
}

export interface HoldSkipStep {
  /** Where the jump lands. */
  readonly positionMs: number;
  /** The total moved since the hold began, this jump included: negative going back. */
  readonly movedMs: number;
  /**
   * The jump reached the start or the end, so the hold jumps no more. Back
   * stops at 0:00 and never goes to the previous song; forward lands on the
   * end, so the song ends as if it played out and the queue moves on.
   */
  readonly last: boolean;
}

/** One jump of a held button in [direction], after [movedMs] moved by the earlier ones. */
export const holdSkipStep = (
  { positionMs, durationMs }: HoldSkipFrom,
  direction: HoldSkipDirection,
  movedMs: number,
): HoldSkipStep => {
  const end = durationMs ?? Number.POSITIVE_INFINITY;
  const from = Math.min(Math.max(0, positionMs), end);
  const wanted = direction === "forward" ? from + HOLD_SKIP_STEP_MS : from - HOLD_SKIP_STEP_MS;
  const to = Math.min(Math.max(0, wanted), end);
  return {
    positionMs: to,
    movedMs: movedMs + (to - from),
    last: direction === "forward" ? to >= end : to <= 0,
  };
};

/** The whole seconds the label shows for [movedMs], without its sign. */
export const holdSkipSeconds = (movedMs: number): number => Math.round(Math.abs(movedMs) / 1_000);
