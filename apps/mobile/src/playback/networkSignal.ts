import { useSyncExternalStore } from "react";
import { AccessibilityInfo } from "react-native";

import { currentLocalisation } from "@/localisation/localisation";
import { connectivityNow, subscribeConnectivity } from "@/native/waveNative";

import { makeNetworkSignalStore, type ShownNetworkSignal } from "./networkSignalStore";
import { playbackState } from "./Player";

/** The playing song's network signal (Core's `networkSignal`), for the mini player and Now Playing. */
export const networkSignalState = makeNetworkSignalStore({
  playback: playbackState,
  connectivity: {
    get: connectivityNow,
    subscribe: (listener) => subscribeConnectivity(() => listener()),
  },
  now: Date.now,
  setTimer: (run, ms) => {
    const timer = setTimeout(run, ms);
    return () => clearTimeout(timer);
  },
  announce: (text) => AccessibilityInfo.announceForAccessibility(text),
  strings: () => currentLocalisation().strings,
});

export const useNetworkSignal = (): ShownNetworkSignal =>
  useSyncExternalStore(networkSignalState.subscribe, networkSignalState.get);
