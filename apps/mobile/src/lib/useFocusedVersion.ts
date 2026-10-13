import { focusedVersion, startFocusedVersion, type FocusedVersionEvent } from "@wave/core";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";

import { useNowPlayingShown } from "@/nowPlaying/sheet";

import type { ExternalStore } from "./externalStore";

/**
 * `store`'s version as the screen should show it: every change while the
 * screen is focused, none while it's hidden (tabs stay mounted), and the
 * latest one as soon as it's focused again. Now Playing is a sheet over the
 * app, so a screen under it counts as hidden too. A hidden screen doesn't even
 * re-render. `store` must be stable.
 */
export const useFocusedVersion = (store: ExternalStore<number>): number => {
  const [state, setState] = useState(() => startFocusedVersion(store.get()));
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

  const covered = useNowPlayingShown();
  useEffect(() => {
    dispatch(covered ? { type: "cover" } : { type: "uncover", version: store.get() });
  }, [covered, store, dispatch]);

  return state.shown;
};
