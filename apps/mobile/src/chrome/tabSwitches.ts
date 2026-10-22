import { startTabSwitch, stepTabSwitch, type TabBarTab } from "@wave/core";
import { useCallback, useLayoutEffect, useRef } from "react";

import { TAB_PATH } from "@wave/core";
import { activeTiming, beginTiming, timingResponse, timingTransitionEnd } from "@/lib/timing";
import { perfMark } from "@/perf/perf";

import { tabLook } from "./tabs";

/** expo-router's switch to a tab by name (`useTabTrigger().switchTab`). */
export type SwitchTab = (name: string, options: { resetOnFocus?: boolean }) => void;

/** The tapped tab's trigger (`useTabTrigger`). */
export interface TappedTrigger {
  readonly switchTab: SwitchTab;
  /**
   * The trigger's own press (`triggerProps.onPress`): emits `tabPress`, which
   * scrolls the tab's list to the top (`useScrollToTop`) and pops its stack
   * to its root.
   */
  readonly press: () => void;
}

/**
 * Tab bar taps, through Core's `stepTabSwitch`: a tap switches at once, taps
 * while that switch is on its way only say where to end up, and the tabs
 * settle on the last tab tapped. [tab] is the tab the current commit shows;
 * [enter] plays a tapped tab's arrival (`useTabEntry`). A re-tap of the tab
 * on screen runs the trigger's own press instead (back to its top and root).
 * Returns the stable tap handler for the tab bar: the tapped tab, and its
 * trigger.
 *
 * Perf builds mark `tab.settled` (detail: the tab's label) when a tab shows
 * with no switch left on its way.
 */
export function useTabSwitches(
  tab: TabBarTab | null,
  enter: (from: TabBarTab, to: TabBarTab) => void,
): (to: TabBarTab, trigger: TappedTrigger) => void {
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
    if (tab !== null && step.state.sent === null) {
      perfMark("tab.settled", tabLook(tab).label);
      const active = activeTiming();
      if (active?.kind === "tab") {
        timingResponse(active.id);
        if (step.enter === null) timingTransitionEnd(active.id);
      }
    }
  }, [tab, enter]);

  return useCallback((to: TabBarTab, trigger: TappedTrigger) => {
    if (to !== switches.current.shown) beginTiming("tab", TAB_PATH[to]);
    switchTab.current = trigger.switchTab;
    const step = stepTabSwitch<TabBarTab>(switches.current, {
      type: "tap",
      tab: to,
      at: performance.now(),
    });
    switches.current = step.state;
    if (step.send !== null) trigger.switchTab(step.send, {});
    if (step.retapped) trigger.press();
  }, []);
}
