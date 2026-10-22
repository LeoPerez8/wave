import { createBackExitConfirmation } from "@wave/core";
import { useNavigationContainerRef } from "expo-router";
import { useEffect, useState } from "react";
import { AppState, BackHandler, Platform } from "react-native";

import { beginTiming } from "@/lib/timing";
import { closeNowPlaying, isNowPlayingShown, onNowPlayingShownChange } from "@/nowPlaying/sheet";
import { useIsSelecting } from "@/selection/selection";

import { dismissTopOverlay, useOverlayEntries } from "./overlay";
import { showToast } from "./toast";

/**
 * Last stop after screen handlers and the navigator: never leave the activity
 * with a card/player visible, and require two root presses within two seconds.
 * exitApp uses Android's normal activity behavior; playback services are untouched.
 */
export function AndroidBack(): null {
  const navigation = useNavigationContainerRef();
  const entries = useOverlayEntries();
  const selecting = useIsSelecting();
  const [confirmation] = useState(createBackExitConfirmation);
  // Opening/closing a card or selection cancels an earlier root exit attempt.
  // oxlint-disable-next-line react/exhaustive-effect-dependencies -- these state changes deliberately reset the window
  useEffect(() => confirmation.reset(), [confirmation, entries, selecting]);
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const reset = () => confirmation.reset();
    const unsubscribe = navigation.addListener("state", reset);
    const activity = AppState.addEventListener("change", reset);
    const player = onNowPlayingShownChange(reset);
    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      if (dismissTopOverlay()) {
        reset();
        return true;
      }
      if (isNowPlayingShown()) {
        reset();
        closeNowPlaying();
        return true;
      }
      // The navigator may be registered before or after this fallback.
      if (navigation.canGoBack()) {
        beginTiming("pop", "Back");
        reset();
        return false;
      }
      if (confirmation.press(performance.now())) BackHandler.exitApp();
      else void showToast("Press Back again within 2 seconds to exit");
      return true;
    });
    return () => {
      back.remove();
      activity.remove();
      player();
      unsubscribe();
    };
  }, [navigation, confirmation]);
  return null;
}
