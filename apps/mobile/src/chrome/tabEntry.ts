import { scheduleOnRN, scheduleOnUI } from "react-native-worklets";
import { activeTiming, timingMotionStarted, timingTransitionEnd } from "@/lib/timing";
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
 *
 * The motion starts once the tab's first frame is drawn (#1536): the frame that attaches, lays
 * out and draws the tab shows it still, where the slide starts, and the slide runs from the UI
 * frame after it. Started in the same commit, the slide shared its first frames with that work
 * and lost some of them. Its UI frames are counted apart from then (`timingMotionStarted`), and
 * the tab switch's timing still ends as it ends.
 */
export function useTabEntry() {
  const reduceMotion = useReducedMotion();
  const bar = useTabBar();
  const progress = useSharedValue(1);
  const side = useSharedValue(0);
  // The latest tap's entry: a newer one takes over an entry still waiting for its first frame.
  const entries = useSharedValue(0);

  const enter = useCallback(
    (from: TabBarTab, to: TabBarTab) => {
      const timingId = activeTiming()?.id;
      const direction = reduceMotion ? 0 : Math.sign(bar.indexOf(to) - bar.indexOf(from));
      const duration = reduceMotion ? ENTRY.fadeMs : ENTRY.slideMs;
      // From the layout effect of the commit showing the tab, so the UI thread mounts that commit
      // no later than the first frame below: that frame attaches and draws the tab, and the one
      // after it comes once it's drawn.
      scheduleOnUI(() => {
        "worklet";
        const entry = entries.get() + 1;
        entries.set(entry);
        side.set(direction);
        progress.set(0);
        requestAnimationFrame(() => {
          requestAnimationFrame((at: number) => {
            if (entries.get() !== entry) return;
            progress.set(
              withTiming(1, { duration, easing: ENTRY.ease }, (finished) => {
                if (finished && timingId !== undefined) scheduleOnRN(timingTransitionEnd, timingId);
              }),
            );
            if (timingId !== undefined) scheduleOnRN(timingMotionStarted, timingId, at);
          });
        });
      });
    },
    [bar, reduceMotion, progress, side, entries],
  );

  const style = useAnimatedStyle(() => ({
    opacity: ENTRY.tabOpacity + (1 - ENTRY.tabOpacity) * progress.get(),
    transform: [{ translateX: side.get() * ENTRY.slide * (1 - progress.get()) }],
  }));
  return { style, enter };
}
