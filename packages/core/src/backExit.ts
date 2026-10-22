/** A second Back at the root must arrive within two seconds of the hint. */
export const BACK_EXIT_WINDOW_MS = 2_000;

/** Root-only exit confirmation. Reset whenever navigation or app activity changes. */
export const createBackExitConfirmation = () => {
  let firstPress: number | null = null;
  return {
    press(now: number): boolean {
      if (firstPress !== null && now >= firstPress && now - firstPress < BACK_EXIT_WINDOW_MS) {
        firstPress = null;
        return true;
      }
      firstPress = now;
      return false;
    },
    reset(): void {
      firstPress = null;
    },
  };
};
