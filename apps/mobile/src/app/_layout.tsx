import "../../global.css";

import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { useAllFilesAccess } from "@/library/hooks";
import { startInitialScan } from "@/library/runtime";
import { connectPlayer } from "@/playback/actions";
import { TrackActionsSheet } from "@/playback/TrackActionsSheet";
import { useThemeColor } from "@/theme/useThemeColor";

export default function RootLayout() {
  const background = useThemeColor("background");
  const { granted } = useAllFilesAccess();

  useEffect(connectPlayer, []);

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
            <Stack.Screen name="now-playing" options={{ animation: "slide_from_bottom" }} />
          </Stack.Protected>
          <Stack.Protected guard={!granted}>
            <Stack.Screen name="access" options={{ animation: "fade" }} />
          </Stack.Protected>
        </Stack>
        <TrackActionsSheet />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
