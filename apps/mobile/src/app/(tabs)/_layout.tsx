import { TAB_PATH, tabOfPath, type TabBarTab } from "@wave/core";
import { router, usePathname } from "expo-router";
import { TabList, TabSlot, TabTrigger, Tabs } from "expo-router/ui";
import { useEffect } from "react";
import { View } from "react-native";
import Animated from "react-native-reanimated";

import { BACKDROP, ChromeProvider } from "@/chrome/chrome";
import { TabBar } from "@/chrome/TabBar";
import { useTabEntry } from "@/chrome/tabEntry";
import { openNowPlaying } from "@/nowPlaying/sheet";
import { MiniPlayer } from "@/playback/MiniPlayer";
import { useIsSelecting } from "@/selection/selection";
import { SelectionChrome } from "@/selection/SelectionChrome";
import { useTabBar } from "@/settings/tabBar";
import { useThemeColor } from "@/theme/useThemeColor";

/** Every tab the bar can hold; the bar shows those the owner picked. */
const TABS = Object.entries(TAB_PATH) as [TabBarTab, string][];

/**
 * The tabs the owner arranged (Home, then any of Library, the Library's
 * sections and Search) under the floating glass chrome. The screens sit in
 * the backdrop the glass shows through; the tab bar and mini player float
 * over it as siblings, so the glass never has to draw itself. A tapped switch
 * slides the new screen in from the tapped tab's side; the chrome stays put.
 */
export default function TabsLayout() {
  const background = useThemeColor("background");
  const tab = tabOfPath(usePathname());
  const bar = useTabBar();
  const entry = useTabEntry(tab);
  const selecting = useIsSelecting();
  // The tab showing was taken off the bar: Home, which can't go, takes over.
  const gone = tab !== null && !bar.includes(tab);
  useEffect(() => {
    if (gone) router.navigate(TAB_PATH.index);
  }, [gone]);
  return (
    <ChromeProvider tabBar>
      <Tabs style={{ flex: 1, backgroundColor: background }}>
        <View nativeID={BACKDROP.tabs} collapsable={false} className="flex-1">
          <Animated.View style={[{ flex: 1 }, entry.style]}>
            <TabSlot />
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
            <MiniPlayer backdropId={BACKDROP.tabs} onOpen={openNowPlaying} />
            <TabBar onTabTap={entry.noteTap} />
          </>
        )}
      </Tabs>
    </ChromeProvider>
  );
}
