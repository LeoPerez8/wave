import "../../global.css";
// Lays the chosen theme colours over global.css's before anything renders.
// oxlint-disable-next-line import/no-unassigned-import
import "@/settings/theme";

import { Stack } from "expo-router";
import logotype from "@expo-google-fonts/inter/100Thin/Inter_100Thin.ttf.png";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { followLibraryLookupSummary } from "@/library/findLyricsAndGenre";
import { useAllFilesAccess } from "@/library/hooks";
import { primePlaylists } from "@/library/playlists";
import { OverlayHost } from "@/overlay/OverlayHost";
import { useTrackCurrentPath } from "@/library/routes";
import { useOpenSharedText } from "@/library/sharedText";
import { startInitialScan } from "@/library/runtime";
import { NowPlayingSheet, UnderNowPlaying } from "@/nowPlaying/NowPlayingSheet";
import { startServices } from "@/services";
import { startSync } from "@/sync/startSync";
import { useThemeColor } from "@/theme/useThemeColor";

// TEMPORARY CI probe: a package image Metro must emit as a new resource.
export const ciProbeAsset = logotype;

export default function RootLayout() {
  const background = useThemeColor("background");
  const { granted } = useAllFilesAccess();
  // Lets library screens open inside the tab they were opened from.
  useTrackCurrentPath();
  // A playlist link shared from YT Music or a browser opens its import card, once Wave can
  // read the Library (the import matches against it).
  useOpenSharedText(granted);

  // A no-op when Android Auto already started them headless (src/services.ts).
  useEffect(() => startServices("app"), []);

  // While signed in to a Wave account, the Library syncs with it (src/sync/WaveSync.ts).
  useEffect(startSync, []);

  // A whole-Library lyrics and genre run that ended in the background says how it went.
  useEffect(followLibraryLookupSummary, []);

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
