import "../../global.css";
// Lays the chosen theme colours over global.css's before anything renders.
// oxlint-disable-next-line import/no-unassigned-import
import "@/settings/theme";

import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { useAllFilesAccess } from "@/library/hooks";
import { primePlaylists } from "@/library/playlists";
import { OverlayHost } from "@/overlay/OverlayHost";
import { useTrackCurrentPath } from "@/library/routes";
import { startInitialScan } from "@/library/runtime";
import { NowPlayingSheet, UnderNowPlaying } from "@/nowPlaying/NowPlayingSheet";
import { startServices } from "@/services";
import { useThemeColor } from "@/theme/useThemeColor";

export default function RootLayout() {
  const background = useThemeColor("background");
  const { granted } = useAllFilesAccess();
  // Lets library screens open inside the tab they were opened from.
  useTrackCurrentPath();

  // A no-op when Android Auto already started them headless (src/services.ts).
  useEffect(() => startServices("app"), []);

  // The first scan starts as soon as Wave can read the scan roots.
  useEffect(() => {
    if (granted) {
      startInitialScan();
      // Playlists don't wait for the scan: they live in the database already.
      primePlaylists();
    }
  }, [granted]);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: background }}>
      <SafeAreaProvider>
        <StatusBar style="auto" />
        <OverlayHost>
          <UnderNowPlaying>
            <Stack
              screenOptions={{ headerShown: false, contentStyle: { backgroundColor: background } }}
            >
              <Stack.Protected guard={granted}>
                <Stack.Screen name="(tabs)" />
              </Stack.Protected>
              <Stack.Protected guard={!granted}>
                <Stack.Screen name="access" options={{ animation: "fade" }} />
              </Stack.Protected>
            </Stack>
          </UnderNowPlaying>
          {/* Always mounted, out of sight until opened, so a tap only starts its spring. */}
          {granted ? <NowPlayingSheet /> : null}
        </OverlayHost>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
