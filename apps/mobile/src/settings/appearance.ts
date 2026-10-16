import { readAppearance, storedAppearance, type Appearance } from "@wave/core";
import { useEffect } from "react";
import { useColorScheme } from "react-native";
import { Uniwind } from "uniwind";

import { persistedSetting } from "@/lib/persistedSetting";
import { WaveNative } from "@/native/waveNative";

const followers = new Set<(appearance: Appearance) => void>();

/**
 * Switches every className, `useThemeColor` reader and `useColorScheme` (the
 * status bar's style with it) to the chosen scheme, or back to Android's.
 * Android keeps the choice natively too, so the launch splash and system bars
 * open in it on the next cold start; on every start as well, so it never drifts.
 */
const apply = (appearance: Appearance): void => {
  Uniwind.setTheme(appearance);
  WaveNative.setAppearance(appearance).catch((error: unknown) =>
    console.warn("[wave] Saving the appearance failed", error),
  );
  for (const follower of followers) follower(appearance);
};

const appearance = persistedSetting<Appearance>({
  key: "settings.appearance",
  synced: true,
  read: readAppearance,
  write: storedAppearance,
  onValue: apply,
});

// Applied on import (the theme imports this, and the root layout imports the theme first).
appearance.get();

/** The chosen appearance: System, Light or Dark. */
export const getAppearance = appearance.get;

/** Calls `follower` with every change of appearance (the notification's accent follows it). */
export const followAppearance = (follower: (appearance: Appearance) => void): void => {
  followers.add(follower);
};

/** Picks System, Light or Dark; the whole app switches at once. */
export const setAppearance = appearance.set;

/** The persisted appearance; re-renders when Settings changes it. */
export const useAppearance = appearance.useValue;

/**
 * Keeps the navigation bar's buttons readable on the scheme Wave shows, as it
 * switches while Wave is open: in Settings, or by Android under System.
 */
export const useNavigationBarScheme = (): void => {
  const dark = useColorScheme() === "dark";
  useEffect(() => {
    WaveNative.setNavigationBarScheme(dark).catch((error: unknown) =>
      console.warn("[wave] Couldn't style the navigation bar", error),
    );
  }, [dark]);
};
