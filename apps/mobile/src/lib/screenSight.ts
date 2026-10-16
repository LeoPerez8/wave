import { useNavigation } from "expo-router";
import { createContext, useContext, useMemo } from "react";

import { isNowPlayingShown, onNowPlayingShownChange } from "@/nowPlaying/sheet";

/**
 * True under `UnderNowPlaying` (the app's screens), which Now Playing covers
 * when it is up. Its own content, and overlays drawn above it, aren't covered.
 */
export const CoveredByNowPlaying = createContext(false);

/**
 * Whether the screen a component is on is in sight: its route is focused (tabs
 * stay mounted; a pushed screen hides the one below) and, for the app's
 * screens, Now Playing isn't over it. Read and followed without rendering.
 */
export interface ScreenSight {
  readonly visible: () => boolean;
  /** Calls [listener] each time the screen comes into or goes out of sight; returns how to stop. */
  readonly subscribe: (listener: (visible: boolean) => void) => () => void;
}

/**
 * The calling component's `ScreenSight`, stable while it stays on the same
 * screen. Following it never re-renders the component: shared Library queries
 * pause and resume on it without touching React state.
 */
export const useScreenSight = (): ScreenSight => {
  const navigation = useNavigation();
  const coverable = useContext(CoveredByNowPlaying);
  return useMemo(() => {
    const covered = (): boolean => coverable && isNowPlayingShown();
    return {
      visible: () => navigation.isFocused() && !covered(),
      subscribe: (listener) => {
        let focused = navigation.isFocused();
        let last = focused && !covered();
        const check = (): void => {
          const now = focused && !covered();
          if (now === last) return;
          last = now;
          listener(now);
        };
        const stops = [
          navigation.addListener("focus", () => {
            focused = true;
            check();
          }),
          navigation.addListener("blur", () => {
            focused = false;
            check();
          }),
        ];
        if (coverable) stops.push(onNowPlayingShownChange(check));
        return () => {
          for (const stop of stops) stop();
        };
      },
    };
  }, [navigation, coverable]);
};
