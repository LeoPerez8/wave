type Subscribe = (listener: () => void) => () => void;

/** Wakes the process-lifetime lookup when network or preferences permit background work. */
export const followReleaseEligibility = (
  allowed: () => boolean,
  resume: () => void,
  sources: readonly Subscribe[],
): void => {
  for (const subscribe of sources)
    subscribe(() => {
      // Running requests check the same current eligibility before sending the next one.
      if (allowed()) resume();
    });
};
