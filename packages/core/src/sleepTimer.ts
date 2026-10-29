/**
 * The sleep timer: what the owner picks in Now Playing, the timer it starts,
 * and how much of it is left.
 *
 * A timer either runs to a wall-clock deadline (15/30/45/60 minutes or a custom
 * duration) or waits for the playing track to finish. The native player
 * enforces it (so it fires with Wave in the background); JS shows it.
 */

import { en, type Catalogue } from "./catalogueEn.ts";
import { formatDuration } from "./time.ts";

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60_000;

/** The preset durations offered, in minutes. */
export const SLEEP_TIMER_PRESETS: readonly number[] = [15, 30, 45, 60];

/** What the owner picks. */
export type SleepTimerChoice =
  { readonly type: "minutes"; readonly minutes: number } | { readonly type: "endOfTrack" };

/**
 * A running timer. A deadline is wall-clock milliseconds, so it keeps counting
 * while playback is paused. `endOfTrack` pauses when the playing track ends,
 * whichever track that is by then.
 */
export type SleepTimer =
  { readonly type: "deadline"; readonly endsAt: number } | { readonly type: "endOfTrack" };

/** Whole seconds shown by a deadline label; End of track has no ticking label. */
export const sleepTimerLabelSeconds = (timer: SleepTimer, now: number): number | null => {
  "worklet";
  return timer.type === "deadline" ? Math.max(0, Math.ceil((timer.endsAt - now) / 1000)) : null;
};

/** The timer a choice starts at `now`. */
export const startSleepTimer = (choice: SleepTimerChoice, now: number): SleepTimer | null => {
  if (choice.type === "endOfTrack") return { type: "endOfTrack" };
  if (!Number.isFinite(choice.minutes) || choice.minutes <= 0) return null;
  return { type: "deadline", endsAt: now + choice.minutes * MS_PER_MINUTE };
};

/** The custom duration's range, and where its stepper starts (past the presets). */
export const CUSTOM_SLEEP_MINUTES = { min: 1, max: 720, initial: 90 } as const;

/** The step used upwards from `minutes`: finer for short durations. */
const stepFrom = (minutes: number): number => (minutes < 10 ? 1 : minutes < 60 ? 5 : 15);

/** One press of the custom duration's minus (-1) or plus (1). */
export const stepSleepMinutes = (minutes: number, direction: 1 | -1): number => {
  const next = direction === 1 ? minutes + stepFrom(minutes) : minutes - stepFrom(minutes - 1);
  return Math.min(CUSTOM_SLEEP_MINUTES.max, Math.max(CUSTOM_SLEEP_MINUTES.min, next));
};

/**
 * The time left as a countdown, e.g. `14:59`. Rounded up to the whole second,
 * so it reads `0:00` only once the timer is due.
 */
export const formatSleepRemaining = (ms: number): string => {
  "worklet";
  return formatDuration(Math.ceil(ms / MS_PER_SECOND) * MS_PER_SECOND);
};

/** A duration in whole minutes as the stepper shows it, e.g. `45 min` or `1 h 30 min`. */
export const formatSleepMinutes = (minutes: number, catalogue: Catalogue = en): string =>
  catalogue.playbackText.sleepDuration(Math.floor(minutes / 60), minutes % 60);

/** The clock and the playhead the remaining time is read against. */
export interface SleepTimerClock {
  readonly now: number;
  readonly positionMs: number;
  readonly durationMs: number | null;
}

/** How long until the timer pauses playback, in ms. */
export const sleepTimerRemaining = (timer: SleepTimer, clock: SleepTimerClock): number | null => {
  "worklet";
  if (timer.type === "deadline") return Math.max(0, timer.endsAt - clock.now);
  if (clock.durationMs === null) return null;
  return Math.max(0, clock.durationMs - clock.positionMs);
};
