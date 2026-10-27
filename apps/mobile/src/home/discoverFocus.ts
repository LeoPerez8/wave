import { useFocusEffect } from "expo-router";
import { useCallback } from "react";

/** One registration owned by Discover, shared by its artist and genre rows. */
export const useDiscoverFocus = (
  enabled: boolean,
  played: boolean | undefined,
  refresh: (played: boolean) => void,
): void => {
  useFocusEffect(
    useCallback(() => {
      // Saved rows can draw before the screen's plays answer.
      if (enabled && played !== undefined) refresh(played);
    }, [enabled, played, refresh]),
  );
};
