/** The sync triggers' tests' clock (`syncTriggers.ts`). */
/// <reference types="node" />
import type { SyncClock } from "./syncTriggers.ts";

/** A clock the test moves by hand; timers run as it passes them. */
export const fakeClock = () => {
  let time = 0;
  let timers: { at: number; run: () => void }[] = [];
  const clock: SyncClock = {
    now: () => time,
    after: (ms, run) => {
      const timer = { at: time + ms, run };
      timers.push(timer);
      return () => {
        timers = timers.filter((other) => other !== timer);
      };
    },
  };
  /** Moves the clock on by [ms], running the timers due on the way. */
  const pass = async (ms: number): Promise<void> => {
    const end = time + ms;
    for (;;) {
      const due = timers
        .filter((timer) => timer.at <= end)
        .sort((a, b) => a.at - b.at)[0];
      if (due === undefined) break;
      timers = timers.filter((timer) => timer !== due);
      time = due.at;
      due.run();
      // Lets a finished sync settle before the next timer.
      await new Promise((resolve) => setImmediate(resolve));
    }
    time = end;
    await new Promise((resolve) => setImmediate(resolve));
  };
  return { clock, pass };
};
