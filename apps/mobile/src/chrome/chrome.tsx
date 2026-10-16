import { inLibraryStack, tabOfPath } from "@wave/core";
import { usePathname } from "expo-router";
import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CELL } from "@/catalog/grid";
import { useNowPlayingShown } from "@/nowPlaying/sheet";
import { playbackState } from "@/playback/Player";
import { useIsSelecting } from "@/selection/selection";

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
  /** Height of the selection bar, which stands in for the tab bar and mini player while selecting. */
  selectionBar: CELL * 8,
  /** Gap between the pills, and between the lowest pill and the system inset. */
  gap: CELL,
} as const;

/** `nativeID`s of the views the glass shows through (siblings of the chrome, never its parents). */
export const BACKDROP = {
  tabs: "wave-backdrop-tabs",
  library: "wave-backdrop-library",
  /** The whole app, under the dialog overlay (src/overlay/OverlayHost.tsx). */
  root: "wave-backdrop-root",
} as const;

/** Whether the floating tab bar is under the screen. */
const ChromeContext = createContext(false);

/**
 * Tells the screens inside whether the floating tab bar is under them. The
 * value is a boolean, so it only changes when that does: every list on every
 * warmed tab reads it (`useChromeInset`), and a new value renders them all.
 */
export function ChromeProvider({ tabBar, children }: { tabBar: boolean; children: ReactNode }) {
  return <ChromeContext value={tabBar}>{children}</ChromeContext>;
}

/** Whether a track is loaded, so the mini player is showing. Ignores position ticks. */
export const useHasNowPlaying = (): boolean =>
  useSyncExternalStore(playbackState.subscribe, () => playbackState.get().item !== null);

/** Distance from the bottom of the screen to the top of the tab bar, or to the inset without one. */
export const useTabBarTop = (): number => {
  const insets = useSafeAreaInsets();
  const tabBar = useContext(ChromeContext);
  return insets.bottom + chrome.gap + (tabBar ? chrome.tabBar + chrome.gap : 0);
};

/**
 * How far the floating chrome on the current screen reaches above the system
 * inset, for things drawn at the root (outside `ChromeProvider`), like menus.
 * Nothing while Now Playing covers it.
 */
export const useFloatingChromeHeight = (): number => {
  const pathname = usePathname();
  const playing = useHasNowPlaying();
  const selecting = useIsSelecting();
  const nowPlaying = useNowPlayingShown();
  if (nowPlaying) return 0;
  if (selecting) return chrome.gap + chrome.selectionBar;
  // Tab screens, and screens opened inside a section tab, are drawn under the floating tab bar.
  const tabBar = tabOfPath(pathname) !== null;
  const miniPlayer = playing && (tabBar || inLibraryStack(pathname));
  return (
    (tabBar ? chrome.gap + chrome.tabBar : 0) + (miniPlayer ? chrome.gap + chrome.miniPlayer : 0)
  );
};

/** Bottom padding that lets a list's last row scroll clear of the floating chrome. */
export const useChromeInset = (): number => {
  const insets = useSafeAreaInsets();
  const tabBarTop = useTabBarTop();
  const playing = useHasNowPlaying();
  const selecting = useIsSelecting();
  if (selecting) return insets.bottom + chrome.gap + chrome.selectionBar + CELL * 3;
  return tabBarTop + (playing ? chrome.miniPlayer + chrome.gap : 0) + CELL * 3;
};
