import {
  SONG_LINK_SAMPLES,
  songLinkSetup,
  songLinkSetupHandling,
  type AppLanguage,
  type SongLinkHandling,
  type SongLinkSetup,
} from "@wave/core";
import { useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";

import { useLocalisation } from "@/localisation/localisation";
import { WaveNative } from "@/native/waveNative";

/**
 * Which song links Android lets Wave open, the apps that still hold theirs and the
 * line saying so; null on an APK without the native read.
 */
export const readSongLinkSetup = (language: AppLanguage): SongLinkSetup | null => {
  const state = WaveNative.songLinkHandling?.();
  if (!state) return null;
  return songLinkSetup(state, WaveNative.songLinkOpeners?.(SONG_LINK_SAMPLES) ?? null, language);
};

/** Which song links open in Wave, without the setup's lines; null on an APK without the native read. */
export const readSongLinkHandling = (): SongLinkHandling | null => {
  const state = WaveNative.songLinkHandling?.();
  if (!state) return null;
  return songLinkSetupHandling(state, WaveNative.songLinkOpeners?.(SONG_LINK_SAMPLES) ?? null);
};

/**
 * Read on mount and again whenever Wave comes back to the foreground: only
 * Android's Open by default pages, other activities, change it, and the screen
 * never loses focus to them.
 */
export const useSongLinkSetup = (): SongLinkSetup | null => {
  const { language } = useLocalisation();
  const [returns, setReturns] = useState(0);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (appState) => {
      if (appState === "active") setReturns((count) => count + 1);
    });
    return () => subscription.remove();
  }, []);
  // `returns` re-reads the phone's state on each return to the foreground.
  return useMemo(() => (returns >= 0 ? readSongLinkSetup(language) : null), [language, returns]);
};

/** Opens the Open by default page of the app that holds a service's links. */
export const openAppLinkSettings = (packageName: string): void => {
  void WaveNative.openAppLinkSettings?.(packageName);
};
