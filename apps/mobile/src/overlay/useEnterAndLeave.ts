import { useLayoutEffect } from "react";
import { Easing, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { TAP_ANIMATION_MS } from "@/motion/timing";

const EASE = Easing.out(Easing.exp);

/**
 * How far something floating at the root (a card, the toast) has come in,
 * from 0 to 1, over 140 ms (at once under reduce motion). It comes in
 * once [ready] (measured, so it appears where it settles) and goes back to 0
 * when [leaving], then `remove(id)` takes it off. A layout effect, so the
 * entrance starts with the frame it is first drawn in.
 */
export const useEnterAndLeave = ({
  id,
  ready,
  leaving,
  remove,
}: {
  readonly id: number;
  readonly ready: boolean;
  readonly leaving: boolean;
  /** Module-level, so it never changes. */
  readonly remove: (id: number) => void;
}): SharedValue<number> => {
  const progress = useSharedValue(0);
  useLayoutEffect(() => {
    if (!ready) return;
    const target = leaving ? 0 : 1;
    const gone = () => remove(id);
    progress.set(
      withTiming(target, { duration: TAP_ANIMATION_MS, easing: EASE }, (finished) => {
        if (finished && target === 0) scheduleOnRN(gone);
      }),
    );
  }, [id, ready, leaving, remove, progress]);
  return progress;
};
