import { type TabBarTab, tabBarTabs } from "@wave/core";
import { useCallback, useLayoutEffect, useRef } from "react";
import {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { ENTRY } from "@/motion/entry";
import { useShortcutTab } from "@/settings/shortcutTab";

export type TabName = TabBarTab;

/**
 * Each tab's route (src/app/(tabs)/): the one source for which paths are tab
 * screens, drawn under the floating tab bar.
 */
export const TAB_PATH = {
  index: "/",
  library: "/library",
  shortcut: "/shortcut",
  search: "/search",
} as const satisfies Record<TabName, string>;

const TABS = Object.keys(TAB_PATH) as TabName[];

/** The tab whose screen `pathname` is, or null for a screen pushed over the tabs. */
export const tabOfPath = (pathname: string): TabName | null =>
  TABS.find((tab) => TAB_PATH[tab] === pathname) ?? null;

/**
 * The style for the view holding the tab screens: after a tapped switch the
 * new screen fades in while sliding from the tapped tab's side. The tab bar
 * calls `noteTap` before switching, so only a tap animates: launching, deep
 * links and Back switch without motion.
 */
export function useTabEntry(tab: TabName | null) {
  const reduceMotion = useReducedMotion();
  const shortcut = useShortcutTab();
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
    const order = tabBarTabs(shortcut);
    side.set(reduceMotion ? 0 : Math.sign(order.indexOf(tab) - order.indexOf(from)));
    progress.set(0);
    progress.set(
      withTiming(1, { duration: reduceMotion ? ENTRY.fadeMs : ENTRY.slideMs, easing: ENTRY.ease }),
    );
  }, [tab, shortcut, reduceMotion, progress, side]);

  const noteTap = useCallback((to: TabName) => {
    tapped.current = to;
  }, []);

  const style = useAnimatedStyle(() => ({
    opacity: progress.get(),
    transform: [{ translateX: side.get() * ENTRY.slide * (1 - progress.get()) }],
  }));
  return { style, noteTap };
}
