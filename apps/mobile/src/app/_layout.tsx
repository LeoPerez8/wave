import "../../global.css";
// Lays the chosen theme colours over global.css's, in the chosen appearance, before anything renders.
// oxlint-disable-next-line import/no-unassigned-import
import "@/settings/theme";

import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { followLibraryLookupSummary } from "@/library/findLyricsAndGenre";
import { useAllFilesAccess } from "@/library/hooks";
import { resumePlaylistImports } from "@/library/playlistImports";
import { primePlaylists } from "@/library/playlists";
import { OverlayHost } from "@/overlay/OverlayHost";
import { FollowCurrentRoute } from "@/library/routes";
import { useOpenSharedText } from "@/library/sharedText";
import { startInitialScan } from "@/library/runtime";
import { NowPlayingSheet, UnderNowPlaying } from "@/nowPlaying/NowPlayingSheet";
import { PERF_ENABLED, perfTouch, useRenderCount } from "@/perf/perf";
import { PerfProbe } from "@/perf/PerfProbe";
import { startServices } from "@/services";
import { useNavigationBarScheme } from "@/settings/appearance";
import { startSync } from "@/sync/startSync";
import { useThemeColor } from "@/theme/useThemeColor";

export default function RootLayout() {
  useRenderCount("RootLayout");
  const background = useThemeColor("background");
  // The status bar follows `useColorScheme` (style "auto"); the navigation bar follows here.
  useNavigationBarScheme();
  const { granted } = useAllFilesAccess();
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
      // Link imports kept when Wave last closed go on filling their playlists.
      resumePlaylistImports();
    }
  }, [granted]);

  return (
    <GestureHandlerRootView
      style={{ flex: 1, backgroundColor: background }}
      // A perf build notes every touch's native timestamp, for the runner's latencies.
      onTouchStart={PERF_ENABLED ? perfTouch : undefined}
    >
      {PERF_ENABLED ? <PerfProbe /> : null}
      {/* Lets library screens open inside the tab they were opened from. The root itself
          doesn't follow the route: that would render it and Now Playing on every navigation. */}
      <FollowCurrentRoute />
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
