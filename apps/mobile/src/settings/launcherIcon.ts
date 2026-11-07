import {
  DEFAULT_THEME_CHOICE,
  LAUNCHER_ICONS,
  launcherIconFor,
  launcherIconOnStart,
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

/** The white default, whose waves Recents already shows: the manifest's own icon. */
const DEFAULT_ICON = launcherIconFor(DEFAULT_THEME_CHOICE);

// This phone's icon is separate from the synced theme choice.
const storedIcon = persistedSetting<LauncherIcon | null>({
  key: "settings.launcherIcon",
  read: (stored) => LAUNCHER_ICONS.find((icon) => icon.id === stored) ?? null,
  write: (icon) => icon?.id ?? null,
});

/**
 * This phone's icon, stored the first time it's asked for: on the update that
 * brought it, the icon the phone shows (Core's `launcherIconOnStart`), before
 * any synced colours are accepted.
 */
export const getLauncherIcon = (choice: ThemeChoice): LauncherIcon => {
  const kept = storedIcon.get();
  if (kept !== null) return kept;
  const applied = WaveNative.appliedLauncherAlias();
  const icon = launcherIconOnStart({
    storedIcon: null,
    appliedIcon: LAUNCHER_ICONS.find((each) => launcherAlias(each) === applied)?.id ?? null,
    launchThemeSaved: WaveNative.hasLaunchTheme(),
    choice,
  });
  storedIcon.set(icon);
  return icon;
};

export const setLauncherIcon = (icon: LauncherIcon): void => storedIcon.set(icon);

/** This phone's stored icon without seeding it; null until a theme first applied. */
export const storedLauncherIcon = (): LauncherIcon | null => storedIcon.get();

/** This phone's stored icon; re-renders when it changes. Null only before the theme first applies. */
export const useStoredLauncherIcon = storedIcon.useValue;

/**
 * Shows the stored icon in the launcher and in Recents. The native side
 * switches the launcher's once Wave leaves the screen, and does nothing when
 * it already shows; Recents takes it at once.
 */
export const showLauncherIcon = (icon: LauncherIcon): void => {
  WaveNative.setLauncherIcon(launcherAlias(icon), ALIASES).catch((error: unknown) =>
    console.warn("[wave] Couldn't switch the launcher icon", error),
  );
  // Recents shows the manifest's icon unless Wave gives its task another (#1006).
  WaveNative.setRecentsIcon(icon.id === DEFAULT_ICON.id ? null : launcherAlias(icon)).catch(
    (error: unknown) => console.warn("[wave] Couldn't show the icon in Recents", error),
  );
};
