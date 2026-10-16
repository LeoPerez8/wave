import type { TabBarTab } from "@wave/core";
import { useCallback } from "react";
import {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { ENTRY } from "@/motion/entry";
import { useTabBar } from "@/settings/tabBar";

/**
 * The style for the view holding the tab screens, and `enter`, which plays
 * a tapped tab's arrival: the new screen slides in from the tapped tab's side
 * while it fades up from `ENTRY.tabOpacity`. It is never transparent, so the
 * content (ready at once for a kept tab) shows from the first frame. With
 * reduce motion it only fades. `useTabSwitches` decides when a tab enters:
 * only after a tap, so launching, links and Back switch without motion.
 */
export function useTabEntry() {
  const reduceMotion = useReducedMotion();
  const bar = useTabBar();
  const progress = useSharedValue(1);
  const side = useSharedValue(0);

  const enter = useCallback(
    (from: TabBarTab, to: TabBarTab) => {
      side.set(reduceMotion ? 0 : Math.sign(bar.indexOf(to) - bar.indexOf(from)));
      progress.set(0);
      progress.set(
        withTiming(1, {
          duration: reduceMotion ? ENTRY.fadeMs : ENTRY.slideMs,
          easing: ENTRY.ease,
        }),
      );
    },
    [bar, reduceMotion, progress, side],
  );

  const style = useAnimatedStyle(() => ({
    opacity: ENTRY.tabOpacity + (1 - ENTRY.tabOpacity) * progress.get(),
    transform: [{ translateX: side.get() * ENTRY.slide * (1 - progress.get()) }],
  }));
  return { style, enter };
}
