import { startTabSwitch, stepTabSwitch, type TabBarTab } from "@wave/core";
import { useCallback, useLayoutEffect, useRef } from "react";

import { perfMark } from "@/perf/perf";

import { tabLook } from "./tabs";

/** expo-router's switch to a tab by name (`useTabTrigger().switchTab`). */
export type SwitchTab = (name: string, options: { resetOnFocus?: boolean }) => void;

/**
 * Tab bar taps, through Core's `stepTabSwitch`: a tap switches at once, taps
 * while that switch is on its way only say where to end up, and the tabs
 * settle on the last tab tapped. [tab] is the tab the current commit shows;
 * [enter] plays a tapped tab's arrival (`useTabEntry`). Returns the stable tap
 * handler for the tab bar: the tapped tab, and its trigger's `switchTab`.
 *
 * Perf builds mark `tab.settled` (detail: the tab's label) when a tab shows
 * with no switch left on its way.
 */
export function useTabSwitches(
  tab: TabBarTab | null,
  enter: (from: TabBarTab, to: TabBarTab) => void,
): (to: TabBarTab, switchTab: SwitchTab) => void {
  const switches = useRef(startTabSwitch<TabBarTab>(tab));
  // The navigator's switch, from the last tap: it reads the navigation state when it runs.
  const switchTab = useRef<SwitchTab | null>(null);

  useLayoutEffect(() => {
    if (tab === switches.current.shown) return;
    const step = stepTabSwitch<TabBarTab>(switches.current, {
      type: "shown",
      tab,
      at: performance.now(),
    });
    switches.current = step.state;
    if (step.enter !== null) enter(step.enter.from, step.enter.to);
    if (step.send !== null) switchTab.current?.(step.send, {});
    if (tab !== null && step.state.sent === null) perfMark("tab.settled", tabLook(tab).label);
  }, [tab, enter]);

  return useCallback((to: TabBarTab, via: SwitchTab) => {
    switchTab.current = via;
    const step = stepTabSwitch<TabBarTab>(switches.current, {
      type: "tap",
      tab: to,
      at: performance.now(),
    });
    switches.current = step.state;
    if (step.send !== null) via(step.send, {});
  }, []);
}
