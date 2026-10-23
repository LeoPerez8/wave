import { AppState } from "react-native";
import { useNavigation } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useSyncExternalStore } from "react";

import { useScreenSight } from "./screenSight";
import {
  activeTiming,
  isScreenSettled,
  onScreenSettled,
  timingContent,
  timingScreenCommitted,
} from "./timing";

/** Main content only: empty, missing and offline states count; a header or skeleton does not. */
export const useScreenContent = (ready: boolean): void => {
  const navigation = useNavigation();
  useLayoutEffect(() => {
    const commit = () => {
      if (navigation.isFocused()) timingScreenCommitted();
    };
    commit();
    return navigation.addListener("focus", commit);
  }, [navigation]);
  useEffect(() => {
    if (!ready) return;
    let frame: number | undefined;
    const drawn = () => {
      if (!navigation.isFocused()) return;
      // Focus may precede FollowCurrentRoute's layout effect. Resolve the ID on the next frame.
      frame = requestAnimationFrame(() => {
        const id = activeTiming()?.id;
        if (id !== undefined && navigation.isFocused()) {
          // The first rAF paints this commit. The second signals that its content was drawn.
          frame = requestAnimationFrame(() => {
            if (navigation.isFocused()) timingContent(id);
          });
        }
      });
    };
    drawn();
    const stop = navigation.addListener("focus", drawn);
    const activity = AppState.addEventListener("change", (state) => {
      if (state === "active") drawn();
    });
    return () => {
      stop();
      activity.remove();
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [ready, navigation]);
};

/** Defers a screen's optional work without adding a global route observer to its subtree. */
export const useScreenSettled = (): boolean => {
  const sight = useScreenSight();
  const subscribe = useCallback(
    (listener: () => void) => {
      const stopSettled = onScreenSettled(listener);
      const stopSight = sight.subscribe(listener);
      return () => {
        stopSettled();
        stopSight();
      };
    },
    [sight],
  );
  return useSyncExternalStore(subscribe, () => sight.visible() && isScreenSettled());
};
