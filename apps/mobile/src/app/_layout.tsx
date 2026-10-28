import { startMediumCovers } from "@/library/mediumCovers";
import "../../global.css";
// Lays the chosen theme colours over global.css's, in the chosen appearance, before anything renders.
// oxlint-disable-next-line import/no-unassigned-import
import "@/settings/theme";

import { Stack } from "expo-router";
import { timingTouch, timingStackListeners, startTimingFrameCollection } from "@/lib/timing";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import type { GestureResponderEvent } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { afterFirstSettled, touchEnded, touchStarted, touchTakenOver } from "@/lib/backgroundWork";
import { followFixSongsSummary } from "@/library/findLyricsAndGenre";
import { useAllFilesAccess } from "@/library/hooks";
import { resumePlaylistImports } from "@/library/playlistImports";
import { resumeYtLibraryImport } from "@/library/ytLibraryImport";
import { primePlaylists } from "@/library/playlists";
import { OverlayHost } from "@/overlay/OverlayHost";
import { AndroidBack } from "@/overlay/AndroidBack";
import { PhotoCropperHost } from "@/library/PhotoCropperHost";
import { FollowCurrentRoute } from "@/library/routes";
import { useOpenSharedText } from "@/library/sharedText";
import { YtLibraryPickerHost } from "@/library/YtLibraryPickerHost";
import { launchScanDone } from "@/library/replacementDuplicates";
import { optimizeLibraryDatabase, startInitialScan } from "@/library/runtime";
import { ErrorScreen } from "@/log/ErrorScreen";
import { NowPlayingSheet, UnderNowPlaying } from "@/nowPlaying/NowPlayingSheet";
import { PERF_ENABLED, perfTouch, useRenderCount } from "@/perf/perf";
import { PerfProbe } from "@/perf/PerfProbe";
import { startServices } from "@/services";
import { SongShareLayer } from "@/share/SongShareLayer";
import { useNavigationBarScheme } from "@/settings/appearance";
import { startSync } from "@/sync/startSync";
import { useThemeColor } from "@/theme/useThemeColor";

/** Every touch holds background work; a perf build also notes its native timestamp. */
const onRootTouchStart = (event: GestureResponderEvent): void => {
  timingTouch(event);
  touchStarted();
  if (PERF_ENABLED) perfTouch(event);
};

/** A render error shows a screen to try again or send the logs from, instead of closing Wave. */
export { ErrorScreen as ErrorBoundary };

export default function RootLayout() {
  useRenderCount("RootLayout");
  useEffect(startTimingFrameCollection, []);
  const background = useThemeColor("background");
  // The status bar follows `useColorScheme` (style "auto"); the navigation bar follows here.
  useNavigationBarScheme();
  const { granted } = useAllFilesAccess();
  // A playlist link shared from YT Music or a browser opens its import card, once Wave can
  // read the Library (the import matches against it).
  useOpenSharedText(granted);

  // What the first screen and the player need starts now: the player, the queue it restores,
  // Auto's responder. A no-op when Android Auto already started them headless (src/services.ts).
  useEffect(() => startServices("app"), []);

  // The rest waits until the first screen has globally settled and quiet frames have passed, then goes one piece per free turn
  // (src/lib/backgroundWork.ts), in this order.
  useEffect(() => {
    if (granted) {
      // The scan, incremental after the first: new files show up, gone ones leave. Then, when
      // it's due, the check for songs a replacement left twice (src/library/replacementDuplicates.ts).
      const stopScan = afterFirstSettled(
        "scan",
        () => void startInitialScan().then(launchScanDone),
      );
      // Link imports kept when Wave last closed go on filling their playlists.
      const stopImports = afterFirstSettled("imports", resumePlaylistImports);
      // A From YT Music batch Android stopped reads the playlists it hadn't, in order.
      const stopYtImport = afterFirstSettled("ytLibraryImport", resumeYtLibraryImport);
      return () => {
        stopScan();
        stopImports();
        stopYtImport();
      };
    }
  }, [granted]);

  // SQLite gathers the planner statistics the Library database lacks (src/library/db/connection.ts).
  useEffect(() => afterFirstSettled("optimize", optimizeLibraryDatabase), []);

  // While signed in to a Wave account, the Library syncs with it (src/sync/WaveSync.ts).
  useEffect(() => afterFirstSettled("sync", startSync), []);

  useEffect(() => {
    // Playlists live in the database already: read ahead for the first Add to Playlist card.
    if (granted) return afterFirstSettled("playlists", primePlaylists);
  }, [granted]);

  useEffect(() => startMediumCovers(), []);

  // A whole-Library lyrics and genre run that ended in the background says how it went.
  useEffect(() => afterFirstSettled("lookupSummary", followFixSongsSummary), []);

  return (
    <GestureHandlerRootView
      style={{ flex: 1, backgroundColor: background }}
      onTouchStart={onRootTouchStart}
      onTouchEnd={touchEnded}
      onTouchCancel={touchTakenOver}
    >
      {PERF_ENABLED ? <PerfProbe /> : null}
      {/* Lets library screens open inside the tab they were opened from. The root itself
          doesn't follow the route: that would render it and Now Playing on every navigation. */}
      <FollowCurrentRoute />
      <AndroidBack />
      <SafeAreaProvider>
        <StatusBar style="auto" />
        <OverlayHost>
          <UnderNowPlaying>
            <Stack
              screenListeners={timingStackListeners}
              screenOptions={{ headerShown: false, contentStyle: { backgroundColor: background } }}
            >
              <Stack.Protected guard={granted}>
                <Stack.Screen name="(tabs)" />
                {/* A Recap's stories cover the whole screen, mini player and tab bar too. */}
                <Stack.Screen
                  name="recap/[id]"
                  options={{ animation: "fade_from_bottom", gestureEnabled: false }}
                />
              </Stack.Protected>
              <Stack.Protected guard={!granted}>
                <Stack.Screen name="access" options={{ animation: "fade" }} />
              </Stack.Protected>
            </Stack>
          </UnderNowPlaying>
          {/* Always mounted, out of sight until opened, so a tap only starts its spring. */}
          {granted ? <NowPlayingSheet /> : null}
          {/* The song share sheet (Share in Now Playing and song menus), over both. */}
          <SongShareLayer />
          {/* Library › Playlists › Import › From YT Music's sheet, while it's up. */}
          <YtLibraryPickerHost />
          {/* A playlist image's crop screen (Change Image, Adjust Image), while it's up. */}
          <PhotoCropperHost />
        </OverlayHost>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
