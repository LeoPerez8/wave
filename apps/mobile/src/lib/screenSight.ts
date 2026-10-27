import { parseTabScreens } from "@wave/core";
import { useNavigation } from "expo-router";
import { createContext, useContext, useMemo } from "react";
import { AppState } from "react-native";

import { isNowPlayingShown, onNowPlayingShownChange } from "@/nowPlaying/sheet";

import { sightOf, useStoreInSight, type ScreenSight, type SightCondition } from "./sight";

export type { ScreenSight } from "./sight";

/**
 * True under `UnderNowPlaying` (the app's screens), which Now Playing covers
 * when it is up. Its own content, and overlays drawn above it, aren't covered.
 */
export const CoveredByNowPlaying = createContext(false);

/** The app in front: in the background (the screen off, another app) nothing is in sight. */
const inFront = (state: string | null | undefined): boolean => state !== "background";
const appInFront: SightCondition = {
  holds: () => inFront(AppState.currentState),
  subscribe: (listener) => {
    const subscription = AppState.addEventListener("change", (state) => listener(inFront(state)));
    return () => subscription.remove();
  },
};

const notCovered: SightCondition = {
  holds: () => !isNowPlayingShown(),
  subscribe: (listener) => onNowPlayingShownChange((shown) => listener(!shown)),
};

/**
 * The calling component's `ScreenSight`, stable while it stays on the same
 * screen: in sight while its route is focused (tabs stay mounted; a pushed
 * screen hides the one below), Now Playing isn't over it (for the app's
 * screens) and the app isn't in the background. Following it never re-renders
 * the component: shared Library queries pause and resume on it without
 * touching React state.
 */
export const useScreenSight = (): ScreenSight => {
  const navigation = useNavigation();
  const coverable = useContext(CoveredByNowPlaying);
  return useMemo(() => {
    const focused: SightCondition = {
      holds: () => navigation.isFocused(),
      subscribe: (listener) => {
        const stops = [
          navigation.addListener("focus", () => listener(true)),
          navigation.addListener("blur", () => listener(false)),
        ];
        return () => {
          for (const stop of stops) stop();
        };
      },
    };
    return coverable ? sightOf(focused, notCovered, appInFront) : sightOf(focused, appInFront);
  }, [navigation, coverable]);
};

/** A bundle built with `EXPO_PUBLIC_WAVE_TABS=follow` keeps hidden screens following stores. */
const FOLLOW_HIDDEN = parseTabScreens(process.env.EXPO_PUBLIC_WAVE_TABS).followHidden;

/**
 * An external store as the calling screen follows it (#722): while the screen
 * is out of sight its changes render nothing, and it catches up once when the
 * screen comes back. For what screens show (playing ids, stars, scan status);
 * [subscribe] and [get] must be stable.
 */
export const useSightedStore = <A>(
  subscribe: (onChange: () => void) => () => void,
  get: () => A,
): A => {
  const sight = useScreenSight();
  return useStoreInSight(FOLLOW_HIDDEN ? null : sight, subscribe, get);
};
