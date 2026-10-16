import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";

/**
 * Which visit to the screen this is: it goes up each time the screen's route
 * is focused again after being left (another screen pushed over it, another
 * tab). Now Playing, a sheet over the app, doesn't leave the screen.
 */
const useVisit = (): number => {
  const [visit, setVisit] = useState(0);
  const left = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (left.current) {
        left.current = false;
        setVisit((count) => count + 1);
      }
      return () => {
        left.current = true;
      };
    }, []),
  );
  return visit;
};

/**
 * State that lasts one visit to the screen: back to [initial] when the screen
 * is left and opened again, or when [list] (what the screen shows, such as a
 * query) changes. Setting it to what it already is does nothing. [initial]
 * must be stable.
 */
export const useVisitState = <T>(initial: T, list = ""): readonly [T, (next: T) => void] => {
  const visit = useVisit();
  const [state, setState] = useState({ visit, list, value: initial });
  const current = state.visit === visit && state.list === list;
  const value = current ? state.value : initial;
  const set = useCallback(
    (next: T) =>
      setState((last) =>
        last.visit === visit && last.list === list && Object.is(last.value, next)
          ? last
          : { visit, list, value: next },
      ),
    [visit, list],
  );
  return [value, set];
};
