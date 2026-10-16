import {
  describeTabScreens,
  keepTabs,
  parseTabScreens,
  TAB_PATH,
  type TabBar,
  type TabBarTab,
} from "@wave/core";
import type { TabSlot } from "expo-router/ui";
import { useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { StyleSheet } from "react-native";
import { Screen } from "react-native-screens";

import { PERF_ENABLED, perfMark, registerPerfMeta } from "@/perf/perf";

/**
 * How hidden tabs are kept (#304). As before by default: taken out of the
 * window and hidden with `display: none`, not frozen. A bundle built with
 * `EXPO_PUBLIC_WAVE_TABS` (e.g. `keep-layout`, `attach`, `freeze`,
 * `retain=3`) picks another, for the phone comparison in
 * docs/performance/304-warmed-tabs.md.
 */
export const TAB_SCREENS = parseTabScreens(process.env.EXPO_PUBLIC_WAVE_TABS);

registerPerfMeta("tabs", () => ({ screens: describeTabScreens(TAB_SCREENS) }), true);

type RenderTab = NonNullable<ComponentProps<typeof TabSlot>["renderFn"]>;

const TAB_NAMES: ReadonlySet<string> = new Set(Object.keys(TAB_PATH));
const isTab = (name: string): name is TabBarTab => TAB_NAMES.has(name);

/**
 * The tabs kept mounted while hidden: the latest ones on the [bar], as many as
 * `TAB_SCREENS.retain`. A tab past that is unmounted and built again on its
 * next visit.
 */
export function useKeptTabs(tab: TabBarTab | null, bar: TabBar): readonly TabBarTab[] {
  const [kept, setKept] = useState<readonly TabBarTab[]>([]);
  const next = keepTabs(kept, tab, bar, TAB_SCREENS.retain);
  // Adjusting state while rendering: React renders again before committing.
  if (next !== kept) setKept(next);
  return next;
}

/**
 * Perf builds: marks `tab.commit` when React has committed the tab showing,
 * with whether it was built for it (`first`) or kept (`warm`).
 */
function TabCommitMark({
  name,
  focused,
  children,
}: {
  name: string;
  focused: boolean;
  children: ReactNode;
}) {
  const mounted = useRef(false);
  useLayoutEffect(() => {
    if (focused) perfMark("tab.commit", `${name} ${mounted.current ? "warm" : "first"}`);
    mounted.current = true;
  }, [focused, name]);
  return children;
}

/**
 * Renders the tab screens for `TabSlot` as expo-router's default does, with
 * `TAB_SCREENS`' choices: a tab not [kept] isn't rendered while hidden, a
 * hidden tab can keep its layout or freeze. Perf builds mark each tab's commit
 * and layout (`tab.commit`, `tab.layout`).
 */
export const renderTabScreens =
  (kept: readonly string[]): RenderTab =>
  (descriptor, { isFocused, loaded }) => {
    const name = descriptor.route.name;
    const { lazy = true } = descriptor.options;
    if (!isFocused && ((lazy && !loaded) || (isTab(name) && !kept.includes(name)))) return null;
    const look = TAB_SCREENS.keepLayout
      ? [styles.laidOut, isFocused ? styles.front : styles.back]
      : [styles.screen, isFocused ? styles.focused : styles.unfocused];
    return (
      <Screen
        key={descriptor.route.key}
        enabled={TAB_SCREENS.detach}
        activityState={isFocused ? 2 : 0}
        freezeOnBlur={TAB_SCREENS.freeze}
        style={look}
        onLayout={
          PERF_ENABLED
            ? () => {
                if (isFocused) perfMark("tab.layout", name);
              }
            : undefined
        }
      >
        {PERF_ENABLED ? (
          <TabCommitMark name={name} focused={isFocused}>
            {descriptor.render()}
          </TabCommitMark>
        ) : (
          descriptor.render()
        )}
      </Screen>
    );
  };

const styles = StyleSheet.create({
  // expo-router's own (TabSlot's defaultTabsSlotRender).
  screen: { flex: 1, position: "relative", height: "100%" },
  focused: { zIndex: 1, display: "flex", flexShrink: 0, flexGrow: 1 },
  unfocused: { zIndex: -1, display: "none", flexShrink: 1, flexGrow: 0 },
  // Kept layout: every tab fills the slot, shown or not, so a switch lays nothing out.
  laidOut: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  front: { zIndex: 1 },
  back: { zIndex: -1 },
});
