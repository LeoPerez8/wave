import {
  LAUNCHER_ICONS,
  launcherIconFor,
  type LauncherBehaviour,
  type ThemeChoice,
} from "@wave/core";

import { WaveNative } from "@/native/waveNative";

import { launcherAlias } from "./launcherAlias";

/**
 * What the owner's launcher (One UI on the Galaxy S24+) does when Wave switches
 * icons. Assumed to drop the home-screen icon, as AOSP's launcher does when an
 * app's launcher activity is turned off, until it's checked on the phone (#101).
 * While true, Settings warns before a colour change that switches the icon.
 */
export const LAUNCHER: LauncherBehaviour = { dropsHomeScreenIcon: true };

const ALIASES = LAUNCHER_ICONS.map(launcherAlias);

/**
 * Shows the choice's icon in the launcher. The native side switches it once
 * Wave leaves the screen, and does nothing when it already shows.
 */
export const showLauncherIconFor = (choice: ThemeChoice): void => {
  WaveNative.setLauncherIcon(launcherAlias(launcherIconFor(choice)), ALIASES).catch(
    (error: unknown) => console.warn("Couldn't switch the launcher icon", error),
  );
};
