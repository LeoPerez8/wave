import {
  catalogueOf,
  startTabSwitch,
  stepTabSwitch,
  type TabBarTab,
  type TabSwitch,
} from "@wave/core";
import { useCallback, useMemo, useRef } from "react";

import { TAB_PATH } from "@wave/core";
import { activeTiming, beginTiming, timingResponse, timingTransitionEnd } from "@/lib/timing";
import { perfMark } from "@/perf/perf";

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

/** The tab bar's tap handler: the tapped tab, and its trigger. */
export type TabTap = (to: TabBarTab, trigger: TappedTrigger) => void;

export interface TabSwitches {
  /** The stable tap handler for the tab bar. */
  readonly tap: TabTap;
  /**
   * Says which tab the current commit shows (null: a screen over the tabs). Call it from a
   * layout effect, as the route changes: the first call says the tab Wave opened on.
   */
  readonly shown: (tab: TabBarTab | null) => void;
}

/**
 * Tab bar taps, through Core's `stepTabSwitch`: a tap switches at once, taps
 * while that switch is on its way only say where to end up, and the tabs
 * settle on the last tab tapped. [enter] plays a tapped tab's arrival
 * (`useTabEntry`). A re-tap of the tab on screen runs the trigger's own press
 * instead (back to its top and root). Returns two stable calls: the tab bar's
 * tap, and `shown`, which the component following the route calls with the
 * tab showing, so the layout holding the tabs needn't render on a switch
 * (#1486).
 *
 * Perf builds mark `tab.settled` (detail: the tab's label) when a tab shows
 * with no switch left on its way.
 */
export function useTabSwitches(enter: (from: TabBarTab, to: TabBarTab) => void): TabSwitches {
  // Null until the first tab shows: Wave opening on it is no switch.
  const switches = useRef<TabSwitch<TabBarTab> | null>(null);
  // The navigator's switch, from the last tap: it reads the navigation state when it runs.
  const switchTab = useRef<SwitchTab | null>(null);

  const shown = useCallback(
    (tab: TabBarTab | null) => {
      const current = switches.current;
      if (current === null) {
        switches.current = startTabSwitch<TabBarTab>(tab);
        return;
      }
      if (tab === current.shown) return;
      const step = stepTabSwitch<TabBarTab>(current, { type: "shown", tab, at: performance.now() });
      switches.current = step.state;
      if (step.enter !== null) enter(step.enter.from, step.enter.to);
      if (step.send !== null) switchTab.current?.(step.send, {});
      if (tab !== null && step.state.sent === null) {
        // The log stays in English.
        perfMark("tab.settled", catalogueOf("en").tabs[tab]);
        const active = activeTiming();
        if (active?.kind === "tab") {
          timingResponse(active.id);
          if (step.enter === null) timingTransitionEnd(active.id);
        }
      }
    },
    [enter],
  );

  const tap = useCallback((to: TabBarTab, trigger: TappedTrigger) => {
    const current = (switches.current ??= startTabSwitch<TabBarTab>(null));
    if (to !== current.shown) beginTiming("tab", TAB_PATH[to]);
    switchTab.current = trigger.switchTab;
    const step = stepTabSwitch<TabBarTab>(current, {
      type: "tap",
      tab: to,
      at: performance.now(),
    });
    switches.current = step.state;
    if (step.send !== null) trigger.switchTab(step.send, {});
    if (step.retapped) trigger.press();
  }, []);

  return useMemo(() => ({ tap, shown }), [tap, shown]);
}
