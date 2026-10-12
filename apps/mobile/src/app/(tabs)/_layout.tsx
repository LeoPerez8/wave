import { TAB_PATH, tabOfPath } from "@wave/core";
import { usePathname } from "expo-router";
import { TabList, TabSlot, TabTrigger, Tabs } from "expo-router/ui";
import { View } from "react-native";
import Animated from "react-native-reanimated";

import { BACKDROP, ChromeProvider } from "@/chrome/chrome";
import { TabBar } from "@/chrome/TabBar";
import { useTabEntry } from "@/chrome/tabEntry";
import { openNowPlaying } from "@/nowPlaying/sheet";
import { MiniPlayer } from "@/playback/MiniPlayer";
import { useThemeColor } from "@/theme/useThemeColor";

/**
 * Home, Library, the shortcut tab chosen in Settings (if any) and Search under
 * the floating glass chrome. The screens sit in the backdrop the glass shows
 * through; the tab bar and mini player float over it as siblings, so the glass
 * never has to draw itself. A tapped switch slides the new screen in from the
 * tapped tab's side; the chrome stays put.
 */
export default function TabsLayout() {
  const background = useThemeColor("background");
  const entry = useTabEntry(tabOfPath(usePathname()));
  return (
    <ChromeProvider tabBar>
      <Tabs style={{ flex: 1, backgroundColor: background }}>
        <View nativeID={BACKDROP.tabs} collapsable={false} className="flex-1">
          <Animated.View style={[{ flex: 1 }, entry.style]}>
            <TabSlot />
          </Animated.View>
        </View>
        {/* Declares the tabs; the visible triggers live in TabBar (the shortcut only when chosen). */}
        <TabList style={{ display: "none" }}>
          <TabTrigger name="index" href={TAB_PATH.index} />
          <TabTrigger name="library" href={TAB_PATH.library} />
          <TabTrigger name="shortcut" href={TAB_PATH.shortcut} />
          <TabTrigger name="search" href={TAB_PATH.search} />
        </TabList>
        <MiniPlayer backdropId={BACKDROP.tabs} onOpen={openNowPlaying} />
        <TabBar onTabTap={entry.noteTap} />
      </Tabs>
    </ChromeProvider>
  );
}
