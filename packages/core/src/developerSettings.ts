/** Counts Settings title activations; only the fifth returns the new visibility. */
export const createDeveloperTitleTaps = () => {
  let count = 0;
  let lastAt: number | null = null;
  return {
    /** [at] is monotonic milliseconds; null leaves visibility and feedback unchanged. */
    tap: (enabled: boolean, at: number): boolean | null => {
      if (lastAt !== null && at - lastAt > 1_500) count = 0;
      lastAt = at;
      count += 1;
      if (count < 5) return null;
      count = 0;
      return !enabled;
    },
    /** Leaving Settings discards any taps still waiting for the fifth. */
    reset: (): void => {
      count = 0;
      lastAt = null;
    },
  };
};
