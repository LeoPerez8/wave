import { TabList, TabSlot, TabTrigger, Tabs } from "expo-router/ui";
import { View } from "react-native";

import { BACKDROP, ChromeProvider } from "@/chrome/chrome";
import { TabBar } from "@/chrome/TabBar";
import { openNowPlaying } from "@/nowPlaying/sheet";
import { MiniPlayer } from "@/playback/MiniPlayer";
import { useThemeColor } from "@/theme/useThemeColor";

/**
 * Home, Library and Search under the floating glass chrome. The screens sit in
 * the backdrop the glass shows through; the tab bar and mini player float over
 * it as siblings, so the glass never has to draw itself.
 */
export default function TabsLayout() {
  const background = useThemeColor("background");
  return (
    <ChromeProvider tabBar>
      <Tabs style={{ flex: 1, backgroundColor: background }}>
        <View nativeID={BACKDROP.tabs} collapsable={false} className="flex-1">
          <TabSlot />
        </View>
        {/* Declares the tabs; the visible triggers live in TabBar. */}
        <TabList style={{ display: "none" }}>
          <TabTrigger name="index" href="/" />
          <TabTrigger name="library" href="/library" />
          <TabTrigger name="search" href="/search" />
        </TabList>
        <MiniPlayer backdropId={BACKDROP.tabs} onOpen={openNowPlaying} />
        <TabBar />
      </Tabs>
    </ChromeProvider>
  );
}
