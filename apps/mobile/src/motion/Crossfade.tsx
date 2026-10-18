import type { ReactNode } from "react";
import Animated, {
  FadeIn,
  FadeOut,
  LayoutAnimationConfig,
  ReduceMotion,
  useReducedMotion,
} from "react-native-reanimated";

/** Long enough to read as the same thing changing, short enough not to hold the eye. */
export const CROSSFADE_MS = 300;

const fadeIn = FadeIn.duration(CROSSFADE_MS).reduceMotion(ReduceMotion.Never);
const fadeOut = FadeOut.duration(CROSSFADE_MS).reduceMotion(ReduceMotion.Never);

/**
 * Shows [children] and crossfades to new ones whenever [swapKey] changes: the
 * old ones fade out where they were, untouchable, while the new ones fade in
 * in their place. It mounts still (no fade on first show) and, with reduce
 * motion on, every change is a plain swap. A one-shot fade, never a loop, so
 * the glass chrome over it re-blurs only while it runs. Give [swapKey]
 * everything the children show (a mix tile's cover and caption).
 */
export function Crossfade({ swapKey, children }: { swapKey: string; children: ReactNode }) {
  const reduceMotion = useReducedMotion();
  return (
    <LayoutAnimationConfig skipEntering>
      <Animated.View
        key={swapKey}
        entering={reduceMotion ? undefined : fadeIn}
        exiting={reduceMotion ? undefined : fadeOut}
      >
        {children}
      </Animated.View>
    </LayoutAnimationConfig>
  );
}
