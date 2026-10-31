/**
 * How long a ranking someone waits for may run before rendering gets its turn: past one frame at
 * 120 Hz, so it takes 12 of every 16.7 ms and JavaScript still answers rendering 60 times a second,
 * as on a 60 Hz phone. The list scrolls natively, so this delays a row mounting, not a scroll's frame.
 */
const AWAITED_RUN_MS = 12;
/** What an awaited run leaves of a longer frame, so a slice ending late still makes that frame. */
const AWAITED_HEADROOM_MS = 4;

/** One budget shared by recommendation readers, including their SQL and CPU stages. */
export const recommendationFrameBudget = (clock: {
  readonly now: () => number;
  readonly intervalMs: () => number;
}) => {
  let started = clock.now();
  const interval = () => {
    const measured = clock.intervalMs();
    return Number.isFinite(measured) && measured > 2 ? measured : 1000 / 120;
  };
  return {
    /** Check at bounded page/slice boundaries; touch quietness never enters this policy. */
    due: (): boolean => clock.now() - started >= interval() - 2,
    /** The same for a ranking someone waits for, with other recommendation work paused. */
    dueAwaited: (): boolean =>
      clock.now() - started >= Math.max(AWAITED_RUN_MS, interval() - AWAITED_HEADROOM_MS),
    /** Called after the host gives a frame to rendering. */
    yielded: (): void => {
      started = clock.now();
    },
  };
};

/** Absolute wall-clock deadline; elapsed time does not depend on timer delivery. */
export const recommendationDeadline = (timeoutMs: number, now: () => number = Date.now) => {
  const endsAt = now() + timeoutMs;
  return {
    remainingMs: (): number => Math.max(0, endsAt - now()),
    expired: (): boolean => now() >= endsAt,
  };
};
