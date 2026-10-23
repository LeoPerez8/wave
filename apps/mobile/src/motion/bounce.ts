import { bounceScale, bounceSpring, type BounceSpring, type SpringShape } from "@wave/core";
import { useMemo } from "react";
import { useReducedMotion } from "react-native-reanimated";

import { useBounceAmount } from "@/settings/bounceAmount";

/**
 * The elasticity pulls and swipes draw with: the owner's Bounce amount as a
 * multiple of Wave's own (0–1.2, Core's `bounceScale`), 0 under Android's
 * reduce motion. Follows Settings at once.
 */
export const useBounceScale = (): number => bounceScale(useBounceAmount(), useReducedMotion());

/**
 * [base] (one of Core's `RETURN_SPRINGS`) scaled by the Bounce amount, for
 * the spring that puts something dragged back when it's let go without acting.
 */
export const useBounceSpring = (base: SpringShape): BounceSpring => {
  const scale = useBounceScale();
  return useMemo(() => bounceSpring(base, scale), [base, scale]);
};
