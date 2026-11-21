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
  /** How strong the specular edge highlight is, in percent of the shipped one; 0 is no rim. */
  readonly rim: number;
}

/** The glass settings, each a level on a slider. */
export type GlassLevelSetting = keyof GlassSettings;

/**
 * Blur, Refraction, Tint and Rim each snap to five levels; level 3 is the glass
 * as it was before it could be tuned. The levels keep it readable: blur never
 * drops to a sharp backdrop and the tint never goes below half, even over busy
 * artwork. Refraction's level 1 is off (blur, tint and rim only), and so is
 * Rim's (no edge highlight).
 */
export const GLASS_SETTINGS = {
  blur: { levels: [8, 16, 24, 36, 48], default: 24 },
  refraction: { levels: [0, 6, 12, 18, 24], default: 12 },
  tint: { levels: [50, 61, 72, 86, 100], default: 72 },
  rim: { levels: [0, 50, 100, 150, 200], default: 100 },
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
 * The rim's level from its two stored fields. `rimLevel` holds the level; `rim` is the switch
 * the rim was before it had levels, which builds from then still read and write, so it is
 * kept beside the level (off only at level 1). The level wins while the switch agrees with
 * it. A switch that contradicts it was written later by such a build, so the switch wins: on
 * is the shipped rim, off is level 1. Without a level the switch reads the same way.
 */
const readRim = (level: unknown, enabled: unknown): number => {
  const off = GLASS_SETTINGS.rim.levels[0];
  const fromSwitch =
    typeof enabled === "boolean" ? (enabled ? GLASS_SETTINGS.rim.default : off) : undefined;
  if (typeof level !== "number" || !Number.isFinite(level)) {
    return fromSwitch ?? GLASS_SETTINGS.rim.default;
  }
  const rim = readLevel(level, "rim");
  return fromSwitch === undefined || enabled === rim > off ? rim : fromSwitch;
};

/**
 * The glass settings from their stored JSON (`writeGlassSettings`): a value off the levels
 * (stored or synced before them) is the nearest level, the rim is read from its level and
 * its switch, and anything missing or unreadable is its default.
 */
export const readGlassSettings = (stored: string | null): GlassSettings => {
  const record = readStoredRecord(stored);
  return {
    blur: readLevel(record.blur, "blur"),
    refraction: readLevel(record.refraction, "refraction"),
    tint: readLevel(record.tint, "tint"),
    rim: readRim(record.rimLevel, record.rim),
  };
};

/**
 * The glass settings as stored and synced, each on its nearest level. The rim's level goes
 * in `rimLevel`, and `rim` stays the switch it was before the levels (false only when the rim
 * is off): a phone on a build from before them reads a `rim` that isn't a boolean as on, and
 * writes that back over the level.
 */
export const writeGlassSettings = (glass: GlassSettings): string => {
  const rimLevel = readLevel(glass.rim, "rim");
  return JSON.stringify({
    blur: readLevel(glass.blur, "blur"),
    refraction: readLevel(glass.refraction, "refraction"),
    tint: readLevel(glass.tint, "tint"),
    rim: rimLevel > GLASS_SETTINGS.rim.levels[0],
    rimLevel,
  });
};

/** A tint percentage as the two-digit hex alpha appended to the surface colour. */
export const glassTintAlpha = (tint: number): string => {
  const alpha = Math.round((Math.min(100, Math.max(0, tint)) / 100) * 255);
  return alpha.toString(16).toUpperCase().padStart(2, "0");
};
