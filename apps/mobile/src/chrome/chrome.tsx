import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CELL } from "@/catalog/grid";
import { playbackState } from "@/playback/Player";

/**
 * The floating chrome: a glass tab bar and a glass mini player hovering over
 * the bottom of the screen, a cell apart. Content scrolls underneath, so lists
 * pad their bottom by `useChromeInset()` to let the last row clear it.
 */
export const chrome = {
  /** Height of the tab bar pill and the Search pill. */
  tabBar: CELL * 8,
  /** Height of the mini player pill. */
  miniPlayer: CELL * 7,
  /** Gap between the pills, and between the lowest pill and the system inset. */
  gap: CELL,
} as const;

/** `nativeID`s of the views the glass shows through (siblings of the chrome, never its parents). */
export const BACKDROP = { tabs: "wave-backdrop-tabs", library: "wave-backdrop-library" } as const;

const ChromeContext = createContext<{ readonly tabBar: boolean }>({ tabBar: false });

/** Tells the screens inside whether the floating tab bar is under them. */
export function ChromeProvider({ tabBar, children }: { tabBar: boolean; children: ReactNode }) {
  return <ChromeContext value={{ tabBar }}>{children}</ChromeContext>;
}

/** Whether a track is loaded, so the mini player is showing. Ignores position ticks. */
export const useHasNowPlaying = (): boolean =>
  useSyncExternalStore(playbackState.subscribe, () => playbackState.get().item !== null);

/** Distance from the bottom of the screen to the top of the tab bar, or to the inset without one. */
export const useTabBarTop = (): number => {
  const insets = useSafeAreaInsets();
  const { tabBar } = useContext(ChromeContext);
  return insets.bottom + chrome.gap + (tabBar ? chrome.tabBar + chrome.gap : 0);
};

/** Bottom padding that lets a list's last row scroll clear of the floating chrome. */
export const useChromeInset = (): number => {
  const tabBarTop = useTabBarTop();
  const playing = useHasNowPlaying();
  return tabBarTop + (playing ? chrome.miniPlayer + chrome.gap : 0) + CELL * 3;
};
