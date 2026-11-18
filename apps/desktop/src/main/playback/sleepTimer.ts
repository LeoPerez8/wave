/**
 * The sleep timer on the desktop: main enforces it, as the phone's player does, so it pauses
 * playback whatever the window is doing. Core's `stepSleepTimer` holds the rules; this keeps
 * the running timer, its wall-clock check and the session's End of track hold.
 */
import {
  sleepTimerCheckIn,
  sleepTimerPausesAtTrackEnd,
  startSleepTimer,
  stepSleepTimer,
  type SleepTimer as Timer,
  type SleepTimerChoice,
  type SleepTimerEvent,
} from "@wave/core";

export interface SleepTimerHost {
  /** Wall-clock milliseconds, the clock deadlines are set on. */
  readonly now: () => number;
  readonly pause: () => Promise<void>;
  /** Has the player end each song paused, holding the next one back. */
  readonly pauseAtTrackEnd: (on: boolean) => Promise<void>;
  /** Runs [run] after [ms]; the result cancels it. */
  readonly schedule: (ms: number, run: () => void) => () => void;
}

export interface DesktopSleepTimer {
  readonly current: () => Timer | null;
  /** Starts [choice], replacing any running timer; null cancels it without pausing. */
  readonly set: (choice: SleepTimerChoice | null) => Promise<void>;
  /** Playback started. */
  readonly resumed: () => Promise<void>;
  /** Playback stopped by itself (the session's `stopped`). */
  readonly stopped: (why: "trackEnd" | "queueEnd") => Promise<void>;
  /** Every change asked for so far has been made. */
  readonly settled: () => Promise<void>;
  readonly close: () => void;
}

export const createSleepTimer = (host: SleepTimerHost): DesktopSleepTimer => {
  let timer: Timer | null = null;
  let cancelCheck: (() => void) | undefined;
  let holding = false;
  let lane = Promise.resolve();
  const serial = (run: () => Promise<void>): Promise<void> => {
    const result = lane.then(run);
    lane = result.catch(() => {});
    return result;
  };
  /** Makes the check and the hold match [next]. */
  const become = async (next: Timer | null) => {
    timer = next;
    cancelCheck?.();
    cancelCheck = undefined;
    const delay = sleepTimerCheckIn(next, host.now());
    if (delay !== null)
      cancelCheck = host.schedule(delay, () => void answer({ type: "check", now: host.now() }));
    const hold = sleepTimerPausesAtTrackEnd(next);
    if (hold !== holding) {
      holding = hold;
      await host.pauseAtTrackEnd(hold);
    }
  };
  const answer = (event: SleepTimerEvent) =>
    serial(async () => {
      const step = stepSleepTimer(timer, event);
      if (step.pause) await host.pause();
      if (step.timer !== timer) await become(step.timer);
      // A check that ran early waits for the rest.
      else if (event.type === "check") await become(timer);
    });
  return {
    current: () => timer,
    set: (choice) =>
      serial(() => become(choice === null ? null : startSleepTimer(choice, host.now()))),
    resumed: () => answer({ type: "resumed", now: host.now() }),
    stopped: (why) => answer({ type: why === "trackEnd" ? "trackFinished" : "queueEnded" }),
    settled: () => lane,
    close: () => {
      cancelCheck?.();
      cancelCheck = undefined;
    },
  };
};
