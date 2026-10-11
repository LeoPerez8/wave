/**
 * Playback time formatting, shared by the scrubber, track rows and lists.
 *
 * Durations are formatted the way Apple Music does: `m:ss` below an hour and
 * `h:mm:ss` from an hour up. Values are truncated to whole seconds, so a track
 * never shows more elapsed time than it has actually played.
 */

const MS_PER_SECOND = 1000;

const toWholeSeconds = (ms: number): number =>
  Number.isFinite(ms) && ms > 0 ? Math.floor(ms / MS_PER_SECOND) : 0;

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** Formats a duration in milliseconds, e.g. `3:07` or `1:02:03`. Invalid or negative input is `0:00`. */
export const formatDuration = (ms: number): string => {
  const total = toWholeSeconds(ms);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0
    ? `${hours}:${pad2(minutes)}:${pad2(seconds)}`
    : `${minutes}:${pad2(seconds)}`;
};

/**
 * Formats the time left in a track for the right side of the scrubber, e.g. `-1:23`.
 *
 * Elapsed and remaining are computed from whole seconds so that the two labels
 * always add up to the formatted duration.
 */
export const formatRemaining = (positionMs: number, durationMs: number): string => {
  const remaining = Math.max(0, toWholeSeconds(durationMs) - toWholeSeconds(positionMs));
  return `-${formatDuration(remaining * MS_PER_SECOND)}`;
};
