import {
  LAUNCHER_ICONS,
  launcherIconFor,
  type LauncherBehaviour,
  type LauncherIcon,
  type ThemeChoice,
} from "@wave/core";

import { WaveNative } from "@/native/waveNative";
import { persistedSetting } from "@/lib/persistedSetting";

import { launcherAlias } from "./launcherAlias";

/**
 * What the owner's launcher (One UI on the Galaxy S24+) does when Wave switches
 * icons. Assumed to drop the home-screen icon, as AOSP's launcher does when an
 * app's launcher activity is turned off, until it's checked on the phone (#101).
 * While true, Settings warns before a colour change that switches the icon.
 */
export const LAUNCHER: LauncherBehaviour = { dropsHomeScreenIcon: true };

const ALIASES = LAUNCHER_ICONS.map(launcherAlias);

// This phone's icon is separate from the synced theme choice.
const storedIcon = persistedSetting<LauncherIcon | null>({
  key: "settings.launcherIcon",
  read: (stored) => LAUNCHER_ICONS.find((icon) => icon.id === stored) ?? null,
  write: (icon) => icon?.id ?? null,
});

/** On update, keep the icon the existing theme showed before accepting any synced colours. */
export const getLauncherIcon = (choice: ThemeChoice): LauncherIcon => {
  const kept = storedIcon.get();
  if (kept !== null) return kept;
  const icon = launcherIconFor(choice);
  storedIcon.set(icon);
  return icon;
};

export const setLauncherIcon = (icon: LauncherIcon): void => storedIcon.set(icon);

/** This phone's stored icon; re-renders when it changes. Null only before the theme first applies. */
export const useStoredLauncherIcon = storedIcon.useValue;

/**
 * Shows the stored icon in the launcher. The native side switches it once
 * Wave leaves the screen, and does nothing when it already shows.
 */
export const showLauncherIcon = (icon: LauncherIcon): void => {
  WaveNative.setLauncherIcon(launcherAlias(icon), ALIASES).catch((error: unknown) =>
    console.warn("[wave] Couldn't switch the launcher icon", error),
  );
};
