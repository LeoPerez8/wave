import { focusedVersion, startFocusedVersion, type FocusedVersionEvent } from "@wave/core";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";

import { isNowPlayingShown, onNowPlayingShownChange } from "@/nowPlaying/sheet";

import type { ExternalStore } from "./externalStore";

/**
 * `store`'s version as the screen should show it: every change while the
 * screen is focused, none while it's hidden (tabs stay mounted), and the
 * latest one as soon as it's focused again. Now Playing is a sheet over the
 * app, so a screen under it counts as hidden too. A hidden screen doesn't even
 * re-render. `store` must be stable.
 */
export const useFocusedVersion = (store: ExternalStore<number>): number => {
  const [state, setState] = useState(() => {
    const start = startFocusedVersion(store.get());
    return isNowPlayingShown() ? focusedVersion(start, { type: "cover" }) : start;
  });
  const dispatch = useCallback(
    (event: FocusedVersionEvent) => setState((current) => focusedVersion(current, event)),
    [],
  );

  useEffect(
    () => store.subscribe(() => dispatch({ type: "change", version: store.get() })),
    [store, dispatch],
  );

  useFocusEffect(
    useCallback(() => {
      dispatch({ type: "focus", version: store.get() });
      return () => dispatch({ type: "blur" });
    }, [store, dispatch]),
  );

  useEffect(
    () =>
      onNowPlayingShownChange((shown) =>
        dispatch(shown ? { type: "cover" } : { type: "uncover", version: store.get() }),
      ),
    [store, dispatch],
  );

  return state.shown;
};
