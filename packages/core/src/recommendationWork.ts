/** One budget shared by recommendation readers, including their SQL and CPU stages. */
export const recommendationFrameBudget = (clock: {
  readonly now: () => number;
  readonly intervalMs: () => number;
}) => {
  let started = clock.now();
  return {
    /** Check at bounded page/slice boundaries; touch quietness never enters this policy. */
    due: (): boolean => {
      const measured = clock.intervalMs();
      const interval = Number.isFinite(measured) && measured > 2 ? measured : 1000 / 120;
      return clock.now() - started >= interval - 2;
    },
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
