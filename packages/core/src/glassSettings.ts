import { readStoredRecord } from "./storedJson.ts";
import type { SliderRange } from "./slider.ts";

/** How the glass surfaces (tab bar, mini player, overlay cards) are tuned in Settings. */
export interface GlassSettings {
  /** Gaussian blur radius of what's behind the glass, in dp. */
  readonly blur: number;
  /** How far the rounded edge bends what's behind it, in dp; 0 is blur, tint and rim only. */
  readonly refraction: number;
  /** How much of the surface colour lies over the blur, in percent. */
  readonly tint: number;
  /** The specular edge highlight. */
  readonly rim: boolean;
}

/** The settings that are a level on a slider (Rim is a switch). */
export type GlassLevelSetting = "blur" | "refraction" | "tint";

/**
 * Blur, Refraction and Tint each snap to five levels; level 3 is the glass as
 * it was before it could be tuned. The levels keep it readable: blur never
 * drops to a sharp backdrop and the tint never goes below half, even over busy
 * artwork. Refraction's level 1 is off (blur, tint and rim only).
 */
export const GLASS_SETTINGS = {
  blur: { levels: [8, 16, 24, 36, 48], default: 24 },
  refraction: { levels: [0, 6, 12, 18, 24], default: 12 },
  tint: { levels: [50, 61, 72, 86, 100], default: 72 },
  rim: { default: true },
} as const;

/** The Settings slider of a level setting: levels 1 to 5, one step each. */
export const GLASS_LEVEL_RANGE: SliderRange = { min: 1, max: 5, step: 1 };

/** The level every slider starts at and Reset returns to. */
export const DEFAULT_GLASS_LEVEL = 3;

export const DEFAULT_GLASS_SETTINGS: GlassSettings = {
  blur: GLASS_SETTINGS.blur.default,
  refraction: GLASS_SETTINGS.refraction.default,
  tint: GLASS_SETTINGS.tint.default,
  rim: GLASS_SETTINGS.rim.default,
};

/** Whether `glass` is the glass as shipped (nothing to reset). */
export const isDefaultGlassSettings = (glass: GlassSettings): boolean =>
  glass.blur === DEFAULT_GLASS_SETTINGS.blur &&
  glass.refraction === DEFAULT_GLASS_SETTINGS.refraction &&
  glass.tint === DEFAULT_GLASS_SETTINGS.tint &&
  glass.rim === DEFAULT_GLASS_SETTINGS.rim;

/**
 * The level (1 to 5) of `setting` nearest `value`; halfway between two levels
 * is the lower one, and a value that isn't a number is the default level.
 */
export const glassLevel = (setting: GlassLevelSetting, value: number): number => {
  if (!Number.isFinite(value)) return DEFAULT_GLASS_LEVEL;
  let nearest = 0;
  let distance = Number.POSITIVE_INFINITY;
  GLASS_SETTINGS[setting].levels.forEach((level, index) => {
    if (Math.abs(level - value) < distance) {
      distance = Math.abs(level - value);
      nearest = index;
    }
  });
  return GLASS_LEVEL_RANGE.min + nearest;
};

/** The value of `setting` at slider `level`, the level rounded and held to 1 to 5. */
export const glassLevelValue = (setting: GlassLevelSetting, level: number): number => {
  const held = Number.isFinite(level)
    ? Math.min(GLASS_LEVEL_RANGE.max, Math.max(GLASS_LEVEL_RANGE.min, Math.round(level)))
    : DEFAULT_GLASS_LEVEL;
  return (
    GLASS_SETTINGS[setting].levels[held - GLASS_LEVEL_RANGE.min] ?? GLASS_SETTINGS[setting].default
  );
};

const readLevel = (value: unknown, setting: GlassLevelSetting): number =>
  typeof value === "number" && Number.isFinite(value)
    ? glassLevelValue(setting, glassLevel(setting, value))
    : GLASS_SETTINGS[setting].default;

/**
 * The glass settings from their stored JSON: a value off the levels (stored or
 * synced before them) is the nearest level; anything missing or unreadable is
 * its default.
 */
export const readGlassSettings = (stored: string | null): GlassSettings => {
  const record = readStoredRecord(stored);
  return {
    blur: readLevel(record.blur, "blur"),
    refraction: readLevel(record.refraction, "refraction"),
    tint: readLevel(record.tint, "tint"),
    rim: typeof record.rim === "boolean" ? record.rim : GLASS_SETTINGS.rim.default,
  };
};

/** A tint percentage as the two-digit hex alpha appended to the surface colour. */
export const glassTintAlpha = (tint: number): string => {
  const alpha = Math.round((Math.min(100, Math.max(0, tint)) / 100) * 255);
  return alpha.toString(16).toUpperCase().padStart(2, "0");
};
