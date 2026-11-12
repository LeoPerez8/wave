/**
 * The sleep timer: what the owner picks in Now Playing, the timer it starts,
 * and how much of it is left.
 *
 * A timer either runs to a wall-clock deadline (15/30/45/60 minutes or a custom
 * duration) or waits for the playing track or the queue to finish. The native player
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
  | { readonly type: "minutes"; readonly minutes: number }
  | { readonly type: "endOfTrack" }
  | { readonly type: "endOfQueue" };

/**
 * A running timer. A deadline is wall-clock milliseconds, so it keeps counting
 * while playback is paused. `endOfTrack` pauses when the playing track ends,
 * whichever track that is by then. `endOfQueue` prevents more batches and
 * pauses when the queue plays out.
 */
export type SleepTimer =
  | { readonly type: "deadline"; readonly endsAt: number }
  | { readonly type: "endOfTrack" }
  | { readonly type: "endOfQueue" };

/** Whole seconds shown by a deadline label; track and queue endings have no ticking label. */
export const sleepTimerLabelSeconds = (timer: SleepTimer, now: number): number | null => {
  "worklet";
  return timer.type === "deadline" ? Math.max(0, Math.ceil((timer.endsAt - now) / 1000)) : null;
};

/**
 * How long after [now] a deadline's label next shows one second less, in ms;
 * null once it's due, or for End of track, whose label never ticks.
 */
export const sleepTimerLabelChangesIn = (timer: SleepTimer, now: number): number | null => {
  if (timer.type !== "deadline") return null;
  const left = timer.endsAt - now;
  return left <= 0 ? null : left % MS_PER_SECOND || MS_PER_SECOND;
};

/** The timer a choice starts at `now`. */
export const startSleepTimer = (choice: SleepTimerChoice, now: number): SleepTimer | null => {
  if (choice.type === "endOfQueue") return { type: "endOfQueue" };
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

/**
 * The Sleep Timer entry of the playing song's card: its name, then, while a
 * timer runs, the time left (`14:59`) or End of track.
 */
export const sleepTimerEntryLabel = (
  timer: SleepTimer | null,
  now: number,
  catalogue: Catalogue = en,
): string => {
  const name = catalogue.itemActions.labels.sleepTimer;
  if (timer === null) return name;
  const left =
    timer.type === "endOfQueue"
      ? catalogue.playbackText.endOfQueue2
      : timer.type === "endOfTrack"
        ? catalogue.playbackText.endOfTrack2
        : formatSleepRemaining(Math.max(0, timer.endsAt - now));
  return catalogue.itemActions.sleepTimerIs(left);
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
  if (timer.type === "endOfQueue") return null;
  if (clock.durationMs === null) return null;
  return Math.max(0, clock.durationMs - clock.positionMs);
};
