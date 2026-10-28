import { DEFAULT_GLASS_SETTINGS, readGlassSettings, type GlassSettings } from "@wave/core";
import { useSyncExternalStore } from "react";

import { holdable } from "@/lib/holdable";
import { persistedSetting, sameFields } from "@/lib/persistedSetting";

const glass = persistedSetting<GlassSettings>({
  key: "settings.glass",
  synced: true,
  read: readGlassSettings,
  write: (settings) => JSON.stringify(settings),
  equals: sameFields,
  // Writes wait until a drag settles, so a slider doesn't hit storage every frame.
  persistDelayMs: 300,
});

/** What the app's floating glass draws: the settings, or what they were while held. */
const appliedGlass = holdable(glass);

/** Changes one glass setting; it's saved and synced at once, and the app's glass follows unless held. */
export const setGlassSetting = <K extends keyof GlassSettings>(
  key: K,
  value: GlassSettings[K],
): void =>
  // Read back through Core so the value lands on one of the setting's levels.
  glass.set(readGlassSettings(JSON.stringify({ ...glass.get(), [key]: value })));

/** Puts the glass back as it was before it could be tuned. */
export const resetGlassSettings = (): void => glass.set(DEFAULT_GLASS_SETTINGS);

/** The glass settings now, outside React (the perf build's run metadata). */
export const currentGlassSettings = glass.get;

/** The persisted glass settings; re-renders as Settings changes them (the sliders, the sample card). */
export const useGlassSettings = glass.useValue;

/**
 * Keeps the app's floating glass (tab bar, mini player, toast, cards and menus,
 * selection bar) as it is however the settings change, until released:
 * Settings › Appearance holds it while it's open, so a change redraws only the
 * sample card. Gives the release, which applies the latest settings.
 */
export const holdAppliedGlass = appliedGlass.hold;

/** The glass the app's floating surfaces draw: the settings, or what they were when held. */
export const useAppliedGlassSettings = (): GlassSettings =>
  useSyncExternalStore(appliedGlass.subscribe, appliedGlass.get);
