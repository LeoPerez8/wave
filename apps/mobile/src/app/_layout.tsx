import { useLyricsAndGenreLookupsEnabled } from "@/settings/lyricsAndGenre";
import { PerfProfiler, screenCostLayout } from "@/lib/renderCost";
import { startMediumCovers } from "@/library/mediumCovers";
import "../../global.css";
// Lays the chosen theme colours over global.css's, in the chosen appearance, before anything renders.
// oxlint-disable-next-line import/no-unassigned-import
import "@/settings/theme";

import { Stack } from "expo-router";
import {
  timingTouch,
  timingTouchEnded,
  timingTouchTakenOver,
  timingStackListeners,
  startTimingFrameCollection,
} from "@/lib/timing";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import type { GestureResponderEvent } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import {
  afterFirstSettled,
  startupStep,
  touchEnded, touchStarted, touchTakenOver } from "@/lib/backgroundWork";
import { followFixSongsSummary } from "@/library/findLyricsAndGenre";
import { startKeptPlayTotals } from "@/library/keptPlayTotals";
import { useAllFilesAccess } from "@/library/hooks";
import { resumePlaylistImports } from "@/library/playlistImports";
import { resumeYtLibraryImport } from "@/library/ytLibraryImport";
import { primePlaylists } from "@/library/playlists";
import { LocalisationProvider } from "@/localisation/localisation";
import { OverlayHost } from "@/overlay/OverlayHost";
import { AndroidBack } from "@/overlay/AndroidBack";
import { PhotoCropperHost } from "@/library/PhotoCropperHost";
import { FollowCurrentRoute } from "@/library/routes";
import { useOpenSharedText } from "@/library/sharedText";
import { YtLibraryPickerHost } from "@/library/YtLibraryPickerHost";
import { launchScanDone } from "@/library/replacementDuplicates";
import { optimizeLibraryDatabase, runLibraryUpkeep, startInitialScan } from "@/library/runtime";
import { ErrorScreen } from "@/log/ErrorScreen";
import { startPhoneEffects } from "@/glass/phoneEffects";
import { NowPlayingSheet, UnderNowPlaying } from "@/nowPlaying/NowPlayingSheet";
import { PERF_ENABLED, perfTouch, useRenderCount } from "@/perf/perf";
import { PerfProbe } from "@/perf/PerfProbe";
import { startServices } from "@/services";
import { useRecognizeRequests } from "@/recognize/recognizeRequests";
import { SongShareLayer } from "@/share/SongShareLayer";
import { useNavigationBarScheme } from "@/settings/appearance";
import { settleFirstRun, startFirstRun } from "@/sync/signInInvitation";
import { startSync } from "@/sync/startSync";
import { startWhatsNew } from "@/updates/whatsNew";
import { useThemeColor } from "@/theme/useThemeColor";
import { useStackScreenOptions } from "@/chrome/tabScreens";

/** Every touch holds background work; a perf build also notes its native timestamp. */
const onRootTouchStart = (event: GestureResponderEvent): void => {
  timingTouch(event);
  touchStarted();
  if (PERF_ENABLED) perfTouch(event);
};
const onRootTouchEnd = (event: GestureResponderEvent): void => {
  timingTouchEnded(event);
  touchEnded(event);
};
const onRootTouchCancel = (): void => {
  timingTouchTakenOver();
  touchTakenOver();
};

/** A render error shows a screen to try again or send the logs from, instead of closing Wave. */
export { ErrorScreen as ErrorBoundary };

export default function RootLayout() {
  useRenderCount("RootLayout");
  useEffect(startTimingFrameCollection, []);
  const background = useThemeColor("background");
  const screenOptions = useStackScreenOptions();
  // The status bar follows `useColorScheme` (style "auto"); the navigation bar follows here.
  useNavigationBarScheme();
  const { granted } = useAllFilesAccess();
  // Whether this is a new install, settled before the access screen can be passed.
  useEffect(settleFirstRun, []);
  // A playlist link shared from YT Music or a browser opens its import card, once Wave can
  // read the Library (the import matches against it).
  useOpenSharedText(granted);
  useRecognizeRequests(granted);

  // What the first screen and the player need starts now: the player, the queue it restores,
  // Auto's responder. A no-op when Android Auto already started them headless (src/services.ts).
  useEffect(() => startServices("app"), []);

  // An upgrade's credits, recording keys and titles, and the taste sources' write stamp: first
  // of the startup jobs, so the layer's first build leaves them out (src/library/runtime.ts).
  useEffect(() => afterFirstSettled("libraryUpkeep", runLibraryUpkeep), []);

  // Search's index and the local screens' data read the database, not the music files, so they
  // start whatever All files access says (screensFromMemoryGuard.test.ts).
  useEffect(() => {
    let disposed = false;
    let stopSearch: (() => void) | undefined;
    let stopReady: (() => void) | undefined;
    // Search's index, kept in memory and following the Library from then on (#1354).
    const stopSearchIndexStart = afterFirstSettled("searchIndex", () => {
      void import("@/search/searchIndex").then(({ startSearchIndex }) => {
        if (!disposed) stopSearch = startSearchIndex();
      });
    });
    // The local screens' data, kept in memory before they're opened (#1352).
    const stopReadyStart = afterFirstSettled("readyScreens", () => {
      void import("@/library/readyScreens").then(({ startReadyScreens }) => {
        if (!disposed) stopReady = startReadyScreens();
      });
    });
    return () => {
      disposed = true;
      stopSearchIndexStart();
      stopSearch?.();
      stopReadyStart();
      stopReady?.();
    };
  }, []);

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
      const stopLyricsIndex = afterFirstSettled("lyricsSearchIndex", () => {
        void import("@/library/lyricsSearchIndex").then(({ startLyricsSearchIndex }) => {
          if (!disposed) stopLyrics = startLyricsSearchIndex();
        });
      });
      let disposed = false;
      let stopLyrics: (() => void) | undefined;
      // Link imports kept when Wave last closed go on filling their playlists.
      const stopImports = afterFirstSettled("imports", resumePlaylistImports);
      // A From YT Music batch Android stopped reads the playlists it hadn't, in order.
      const stopYtImport = afterFirstSettled("ytLibraryImport", resumeYtLibraryImport);
      return () => {
        disposed = true;
        stopLyricsIndex();
        stopLyrics?.();
        stopScan();
        stopImports();
        stopYtImport();
      };
    }
  }, [granted]);

  const genreLookups = useLyricsAndGenreLookupsEnabled();
  useEffect(() => {
    if (!granted || !genreLookups) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    const cancel = afterFirstSettled("streamedGenres", () => {
      void import("@/library/streamedGenres").then(({ startStreamedGenres }) => {
        if (!disposed) stop = startStreamedGenres();
      });
    });
    return () => {
      disposed = true;
      cancel();
      stop?.();
    };
  }, [granted, genreLookups]);

  // Mood lookups send candidate titles and artists to Deezer and ReccoBeats: "Fix songs online".
  useEffect(() => {
    if (!granted || !genreLookups) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    const cancel = afterFirstSettled("djMoodFeatures", () => {
      void import("@/dj/djMoodLookup").then(({ startDjMoodLookup }) => {
        if (!disposed) stop = startDjMoodLookup();
      });
    });
    return () => {
      disposed = true;
      cancel();
      stop?.();
    };
  }, [granted, genreLookups]);

  // Library songs' mood features, by their file's ISRC tag, while Fix songs online is on.
  useEffect(() => {
    if (!granted || !genreLookups) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    const cancel = afterFirstSettled("djLibraryMoodFeatures", () => {
      void import("@/dj/djLibraryMoodLookup").then(({ startDjLibraryMoodLookup }) => {
        if (!disposed) stop = startDjLibraryMoodLookup();
      });
    });
    return () => {
      disposed = true;
      cancel();
      stop?.();
    };
  }, [granted, genreLookups]);

  // The kept play totals sum an upgrade's history and credit what Library changes leave owed,
  // a step per settled turn (src/library/keptPlayTotals.ts); readers sum from the history until then.
  useEffect(() => {
    let stop: (() => void) | undefined;
    const cancel = afterFirstSettled("keptPlayTotals", () => {
      stop = startKeptPlayTotals();
    });
    return () => {
      cancel();
      stop?.();
    };
  }, []);

  // This session's heavy effects, logged once; a session drawing the full ones measures its
  // frame times after startup settles, for the next start (src/glass/phoneEffects.ts, #1357).
  useEffect(() => startPhoneEffects(), []);

  // SQLite gathers the planner statistics the Library database lacks (src/library/db/connection.ts).
  useEffect(() => afterFirstSettled("optimize", optimizeLibraryDatabase), []);

  // While signed in to a Wave account, the Library syncs with it (src/sync/WaveSync.ts).
  useEffect(() => afterFirstSettled("sync", startSync), []);

  useEffect(() => {
    // Playlists live in the database already: read ahead for the first Add to Playlist card.
    if (granted) return afterFirstSettled("playlists", primePlaylists);
  }, [granted]);

  useEffect(() => startMediumCovers(), []);

  // After an update, what's new, once the first screen is up: never over first run's access screen.
  useEffect(() => {
    // Called inside the arrow: naming it here would load the card with the first screen (#727).
    if (granted) return afterFirstSettled("whatsNew", () => startWhatsNew());
  }, [granted]);

  // On a new install, the Wave account invitation and tour follow the access screen.
  // Not startup work: it waits for nothing heavy, and the first run's trip to Android's settings
  // can leave startup work waiting (the activity is recreated in the same runtime).
  useEffect(() => {
    if (granted) startFirstRun();
  }, [granted]);

  // A whole-Library lyrics and genre run that ended in the background says how it went.
  useEffect(() => afterFirstSettled("lookupSummary", followFixSongsSummary), []);

  // The root's effects run after every screen's: from here, an unnamed block before the first
  // screen settles is no longer the first mount's (#1434).
  useEffect(() => startupStep("after the first mount"), []);

  return (
    <GestureHandlerRootView
      style={{ flex: 1, backgroundColor: background }}
      onTouchStart={onRootTouchStart}
      onTouchEnd={onRootTouchEnd}
      onTouchCancel={onRootTouchCancel}
    >
      {PERF_ENABLED ? <PerfProbe /> : null}
      {/* Lets library screens open inside the tab they were opened from. The root itself
          doesn't follow the route: that would render it and Now Playing on every navigation. */}
      <FollowCurrentRoute />
      <AndroidBack />
      {/* The language and its text, for every screen and overlay below. */}
      <LocalisationProvider>
        <SafeAreaProvider>
          <StatusBar style="auto" />
          <OverlayHost>
            <UnderNowPlaying>
              <Stack
                screenListeners={timingStackListeners}
                screenLayout={screenCostLayout}
                screenOptions={screenOptions}
              >
                <Stack.Protected guard={granted}>
                  <Stack.Screen name="(tabs)" />
                  {/* A Recap's stories cover the whole screen, mini player and tab bar too. */}
                  <Stack.Screen
                    name="recap/[id]"
                    options={{ animation: "fade_from_bottom", gestureEnabled: false }}
                  />
                  {/* DJ covers them too: its Done bar takes the mini player's place. */}
                  <Stack.Screen name="dj" options={{ animation: "fade_from_bottom" }} />
                </Stack.Protected>
                <Stack.Protected guard={!granted}>
                  <Stack.Screen name="access" options={{ animation: "fade" }} />
                </Stack.Protected>
              </Stack>
            </UnderNowPlaying>
            {/* Always mounted, out of sight until opened, so a tap only starts its spring. */}
            {granted ? (
              <PerfProfiler id="NowPlayingSheet">
                <NowPlayingSheet />
              </PerfProfiler>
            ) : null}
            {/* The song share sheet (Share in Now Playing and song menus), over both. */}
            <SongShareLayer />
            {/* Library › Playlists › Import › From YT Music's sheet, while it's up. */}
            <YtLibraryPickerHost />
            {/* A playlist image's crop screen (Change Image, Adjust Image), while it's up. */}
            <PhotoCropperHost />
          </OverlayHost>
        </SafeAreaProvider>
      </LocalisationProvider>
    </GestureHandlerRootView>
  );
}
