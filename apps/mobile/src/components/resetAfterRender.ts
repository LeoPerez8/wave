import { useCallback, useLayoutEffect, useRef } from "react";
import type { SharedValue } from "react-native-reanimated";

/**
 * A drag's drop: call the returned function when the new order is set, and the next render puts
 * [from], [to] and [travel] back, so the rows drop into place in the same frame the new order
 * renders.
 */
export const useResetAfterRender = (
  from: SharedValue<number>,
  to: SharedValue<number>,
  travel: SharedValue<number>,
) => {
  const resetAfterRender = useRef(false);
  useLayoutEffect(() => {
    if (!resetAfterRender.current) return;
    resetAfterRender.current = false;
    from.set(-1);
    to.set(-1);
    travel.set(0);
  });
  return useCallback(() => {
    resetAfterRender.current = true;
  }, []);
};
