import {
  SONG_LINK_SAMPLES,
  songLinkSetup,
  songLinkSetupHandling,
  type AppLanguage,
  type SongLinkHandling,
  type SongLinkHandlingState,
  type SongLinkOpeners,
  type SongLinkSetup,
} from "@wave/core";
import { useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";

import { useLocalisation } from "@/localisation/localisation";
import { WaveNative } from "@/native/waveNative";

/** Android's state for Wave and the app each sample link opens in; null on an APK without it. */
type SongLinkReadings = {
  readonly state: SongLinkHandlingState;
  readonly openers: SongLinkOpeners | null;
} | null;

const readSongLinkReadings = (): SongLinkReadings => {
  const state = WaveNative.songLinkHandling?.();
  if (!state) return null;
  return { state, openers: WaveNative.songLinkOpeners?.(SONG_LINK_SAMPLES) ?? null };
};

const setupOf = (readings: SongLinkReadings, language: AppLanguage): SongLinkSetup | null =>
  readings && songLinkSetup(readings.state, readings.openers, language);

/**
 * Which song links Android lets Wave open, the apps that still hold theirs and the
 * line saying so; null on an APK without the native read.
 */
export const readSongLinkSetup = (language: AppLanguage): SongLinkSetup | null =>
  setupOf(readSongLinkReadings(), language);

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
  const [readings, setReadings] = useState(readSongLinkReadings);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (appState) => {
      if (appState === "active") setReadings(readSongLinkReadings());
    });
    return () => subscription.remove();
  }, []);
  return useMemo(() => setupOf(readings, language), [readings, language]);
};

/** Opens the Open by default page of the app that holds a service's links. */
export const openAppLinkSettings = (packageName: string): void => {
  void WaveNative.openAppLinkSettings?.(packageName);
};
