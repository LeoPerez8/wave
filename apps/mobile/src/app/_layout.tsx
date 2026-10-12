import "../../global.css";

import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { useAllFilesAccess } from "@/library/hooks";
import { PlaylistSheets } from "@/library/PlaylistSheets";
import { startInitialScan } from "@/library/runtime";
import { TrackActionsSheet } from "@/playback/TrackActionsSheet";
import { startServices } from "@/services";
import { useThemeColor } from "@/theme/useThemeColor";

export default function RootLayout() {
  const background = useThemeColor("background");
  const { granted } = useAllFilesAccess();

  // A no-op when Android Auto already started them headless (src/services.ts).
  useEffect(() => startServices("app"), []);

  // The first scan starts as soon as Wave can read the scan roots.
  useEffect(() => {
    if (granted) startInitialScan();
  }, [granted]);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: background }}>
      <SafeAreaProvider>
        <StatusBar style="auto" />
        <Stack
          screenOptions={{ headerShown: false, contentStyle: { backgroundColor: background } }}
        >
          <Stack.Protected guard={granted}>
            <Stack.Screen name="(tabs)" />
            {/* Now Playing animates itself as a sheet over the tabs (src/nowPlaying/sheet.ts). */}
            <Stack.Screen
              name="now-playing"
              options={{
                presentation: "transparentModal",
                animation: "none",
                contentStyle: { backgroundColor: "transparent" },
              }}
            />
          </Stack.Protected>
          <Stack.Protected guard={!granted}>
            <Stack.Screen name="access" options={{ animation: "fade" }} />
          </Stack.Protected>
        </Stack>
        <TrackActionsSheet />
        <PlaylistSheets />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
