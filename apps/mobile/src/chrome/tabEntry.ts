import { useCallback, useLayoutEffect, useRef } from "react";
import {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { ENTRY } from "@/motion/entry";

/** The tabs in tab-bar order, which decides the side a switch slides in from. */
export const TABS = ["index", "library", "search"] as const;
export type TabName = (typeof TABS)[number];

/** Where each tab lives (src/app/(tabs)/). */
export const TAB_HREF = {
  index: "/",
  library: "/library",
  search: "/search",
} as const satisfies Record<TabName, string>;

/** The tab showing at `pathname`, or null on a screen without the tab bar. */
export const tabOfPath = (pathname: string): TabName | null =>
  TABS.find((tab) => TAB_HREF[tab] === pathname) ?? null;

/**
 * Whether `pathname` is in the Library tab's stack (src/app/library/), pushed
 * over the tabs; it keeps the mini player but not the tab bar.
 */
export const inLibraryStack = (pathname: string): boolean =>
  pathname.startsWith(`${TAB_HREF.library}/`);

/**
 * The style for the view holding the tab screens: after a tapped switch the
 * new screen fades in while sliding from the tapped tab's side. The tab bar
 * calls `noteTap` before switching, so only a tap animates: launching, deep
 * links and Back switch without motion.
 */
export function useTabEntry(tab: TabName | null) {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(1);
  const side = useSharedValue(0);
  const previous = useRef(tab);
  const tapped = useRef<TabName | null>(null);

  useLayoutEffect(() => {
    const from = previous.current;
    previous.current = tab;
    if (from === tab) return;
    const wasTapped = tab !== null && tapped.current === tab;
    tapped.current = null;
    if (!wasTapped || from === null) return;
    side.set(reduceMotion ? 0 : Math.sign(TABS.indexOf(tab) - TABS.indexOf(from)));
    progress.set(0);
    progress.set(
      withTiming(1, { duration: reduceMotion ? ENTRY.fadeMs : ENTRY.slideMs, easing: ENTRY.ease }),
    );
  }, [tab, reduceMotion, progress, side]);

  const noteTap = useCallback((to: TabName) => {
    tapped.current = to;
  }, []);

  const style = useAnimatedStyle(() => ({
    opacity: progress.get(),
    transform: [{ translateX: side.get() * ENTRY.slide * (1 - progress.get()) }],
  }));
  return { style, noteTap };
}
