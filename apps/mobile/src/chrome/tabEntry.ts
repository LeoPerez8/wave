import type { TabBarTab } from "@wave/core";
import { useCallback, useLayoutEffect, useRef } from "react";
import {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { ENTRY } from "@/motion/entry";
import { useTabBar } from "@/settings/tabBar";

/**
 * The style for the view holding the tab screens: after a tapped switch the
 * new screen fades in while sliding from the tapped tab's side. The tab bar
 * calls `noteTap` before switching, so only a tap animates: launching, deep
 * links and Back switch without motion.
 */
export function useTabEntry(tab: TabBarTab | null) {
  const reduceMotion = useReducedMotion();
  const bar = useTabBar();
  const progress = useSharedValue(1);
  const side = useSharedValue(0);
  const previous = useRef(tab);
  const tapped = useRef<TabBarTab | null>(null);

  useLayoutEffect(() => {
    const from = previous.current;
    previous.current = tab;
    if (from === tab) return;
    const wasTapped = tab !== null && tapped.current === tab;
    tapped.current = null;
    if (!wasTapped || from === null) return;
    side.set(reduceMotion ? 0 : Math.sign(bar.indexOf(tab) - bar.indexOf(from)));
    progress.set(0);
    progress.set(
      withTiming(1, { duration: reduceMotion ? ENTRY.fadeMs : ENTRY.slideMs, easing: ENTRY.ease }),
    );
  }, [tab, bar, reduceMotion, progress, side]);

  const noteTap = useCallback((to: TabBarTab) => {
    tapped.current = to;
  }, []);

  const style = useAnimatedStyle(() => ({
    opacity: progress.get(),
    transform: [{ translateX: side.get() * ENTRY.slide * (1 - progress.get()) }],
  }));
  return { style, noteTap };
}
