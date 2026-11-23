import { PerfProfiler, useRenderCost } from "@/lib/renderCost";
import { TAB_PATH, tabOfPath, type TabBar as TabBarTabs, type TabBarTab } from "@wave/core";
import { usePathname } from "expo-router";
import { router } from "@/lib/timingRouter";
import { TabList, TabSlot, TabTrigger, Tabs } from "expo-router/ui";
import { memo, useEffect, useLayoutEffect, useMemo, useState, type ComponentProps } from "react";
import { View } from "react-native";
import Animated from "react-native-reanimated";

import { BACKDROP, ChromeProvider } from "@/chrome/chrome";
import { TabBar } from "@/chrome/TabBar";
import { useTabEntry } from "@/chrome/tabEntry";
import { RememberedLinking } from "@/chrome/tabLinking";
import { renderTabScreens, TAB_SCREENS, useKeptTabs } from "@/chrome/tabScreens";
import { useTabSwitches } from "@/chrome/tabSwitches";
import { openNowPlaying } from "@/nowPlaying/sheet";
import { useRenderCount } from "@/perf/perf";
import { MiniPlayer } from "@/playback/MiniPlayer";
import { useIsSelecting } from "@/selection/selection";
import { SelectionChrome } from "@/selection/SelectionChrome";
import { useTabBar } from "@/settings/tabBar";
import { useThemeColor } from "@/theme/useThemeColor";
import { UpdatePill } from "@/updates/UpdatePill";

/** Every tab the bar can hold; the bar shows those the owner picked. */
const TABS = Object.entries(TAB_PATH) as [TabBarTab, (typeof TAB_PATH)[TabBarTab]][];

/**
 * The tabs the owner arranged (Home, then any of Library, the Library's
 * sections and Search) under the floating glass chrome. The screens sit in
 * the backdrop the glass shows through; the tab bar and mini player float
 * over it as siblings, so the glass never has to draw itself. A tapped switch
 * slides the new screen in from the tapped tab's side; the chrome stays put.
 * Rapid taps settle on the last tab tapped (`useTabSwitches`). Visited tabs
 * stay mounted while hidden, the latest ones on the bar (`useKeptTabs`), so
 * coming back finds their nested route and scroll position as they were.
 *
 * Memoized, and the route is followed by `FollowTab` below it: expo-router
 * renders a layout's route on every navigation, so a tab switch would render
 * the layout and everything it hands its children. The layout renders only
 * when the kept tabs, the bar or the entry motion change (#1486).
 */
export default memo(function TabsLayout() {
  useRenderCount("TabsLayout");
  useRenderCost("TabsLayout");
  const bar = useTabBar();
  const entry = useTabEntry();
  const switches = useTabSwitches(entry.enter);
  const [kept, setKept] = useState<readonly TabBarTab[]>(NONE_KEPT);
  return (
    <>
      <FollowTab bar={bar} shown={switches.shown} onKept={setKept} />
      <TabsShown kept={kept} entryStyle={entry.style} onTabTap={switches.tap} />
    </>
  );
});

const NONE_KEPT: readonly TabBarTab[] = [];

/**
 * Follows the route for the tabs layout and renders nothing, so a tab switch renders only it:
 * tells the tab switches which tab shows, hands the layout the kept tabs when they change, and
 * sends a tab taken off the bar to Home.
 */
function FollowTab({
  bar,
  shown,
  onKept,
}: {
  bar: TabBarTabs;
  shown: (tab: TabBarTab | null) => void;
  onKept: (kept: readonly TabBarTab[]) => void;
}): null {
  const tab = tabOfPath(usePathname());
  const kept = useKeptTabs(tab, bar);
  useLayoutEffect(() => {
    shown(tab);
  }, [tab, shown]);
  // Before the frame is drawn, so a tab kept for the first time is never shown unkept.
  useLayoutEffect(() => {
    onKept(kept);
  }, [kept, onKept]);
  // The tab showing was taken off the bar: Home, which can't go, takes over.
  const gone = tab !== null && !bar.includes(tab);
  useEffect(() => {
    if (gone) router.navigate(TAB_PATH.index);
  }, [gone]);
  return null;
}

type TabsShownProps = {
  /** The tabs kept mounted (`useKeptTabs`). */
  kept: readonly TabBarTab[];
  /** The tab screens' entry motion (`useTabEntry`). */
  entryStyle: ReturnType<typeof useTabEntry>["style"];
  onTabTap: ComponentProps<typeof TabBar>["onTabTap"];
};

/**
 * The tab navigator and its chrome. Memoized: the layout renders again for the
 * bar or a newly kept tab, and those change nothing here unless the kept tabs
 * did (#1439). The navigator reads each tab's route from the router once
 * (`RememberedLinking`, #1486).
 */
const TabsShown = memo(function TabsShown({ kept, entryStyle, onTabTap }: TabsShownProps) {
  useRenderCount("TabsShown");
  const background = useThemeColor("background");
  const renderTabs = useMemo(() => renderTabScreens(kept), [kept]);
  const selecting = useIsSelecting();
  return (
    <ChromeProvider tabBar>
      <RememberedLinking>
        <Tabs style={{ flex: 1, backgroundColor: background }}>
          <View nativeID={BACKDROP.tabs} collapsable={false} className="flex-1">
            <Animated.View style={[{ flex: 1 }, entryStyle]}>
              <TabSlot detachInactiveScreens={TAB_SCREENS.detach} renderFn={renderTabs} />
            </Animated.View>
          </View>
          {/* Declares every tab; the visible triggers, those on the bar, live in TabBar. */}
          <TabList style={{ display: "none" }}>
            {TABS.map(([name, href]) => (
              <TabTrigger key={name} name={name} href={href} />
            ))}
          </TabList>
          {/* A list selecting swaps the mini player and tab bar for its selection bar. */}
          {selecting ? (
            <SelectionChrome backdropId={BACKDROP.tabs} />
          ) : (
            <>
              <UpdatePill />
              <PerfProfiler id="MiniPlayer">
                <MiniPlayer backdropId={BACKDROP.tabs} onOpen={openNowPlaying} />
              </PerfProfiler>
              <PerfProfiler id="TabBar">
                <TabBar onTabTap={onTabTap} />
              </PerfProfiler>
            </>
          )}
        </Tabs>
      </RememberedLinking>
    </ChromeProvider>
  );
});
