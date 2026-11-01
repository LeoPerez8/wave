import { useIsFocused } from "expo-router";
import { useEffect } from "react";

import { makeExternalStore } from "@/lib/externalStore";

/** How many list pills are really on screen. The update pill waits for them to leave. */
export const listPillsUp = makeExternalStore(0);

/**
 * Counts the calling pill for as long as its screen is in front. A stack keeps a screen mounted under
 * the one pushed over it, and tabs keep theirs, but a pill there isn't in anyone's way.
 */
export const useListPillOnScreen = (): void => {
  const focused = useIsFocused();
  useEffect(() => {
    if (!focused) return;
    listPillsUp.update((up) => up + 1);
    return () => listPillsUp.update((up) => up - 1);
  }, [focused]);
};
