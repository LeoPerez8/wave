import { DEFAULT_GLASS_SETTINGS, readGlassSettings, type GlassSettings } from "@wave/core";

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

/** Changes one glass setting; every glass surface follows at once. */
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

/** The persisted glass settings; re-renders when Settings changes them. */
export const useGlassSettings = glass.useValue;
