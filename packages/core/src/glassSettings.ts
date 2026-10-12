import { readStoredRecord } from "./storedJson.ts";
import { snapSliderValue, type SliderRange } from "./slider.ts";

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

/**
 * Slider ranges and defaults. The defaults are the glass as it was before it
 * could be tuned. The limits keep it readable: blur never drops to a sharp
 * backdrop and the tint never goes below half, even over busy artwork.
 */
export const GLASS_SETTINGS = {
  blur: { min: 8, max: 48, step: 1, default: 24 },
  refraction: { min: 0, max: 24, step: 1, default: 12 },
  tint: { min: 50, max: 100, step: 1, default: 72 },
  rim: { default: true },
} as const;

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

const readNumber = (value: unknown, range: SliderRange & { default: number }): number =>
  typeof value === "number" && Number.isFinite(value)
    ? snapSliderValue(value, range)
    : range.default;

/** The glass settings from their stored JSON; anything missing or unreadable is its default. */
export const readGlassSettings = (stored: string | null): GlassSettings => {
  const record = readStoredRecord(stored);
  return {
    blur: readNumber(record.blur, GLASS_SETTINGS.blur),
    refraction: readNumber(record.refraction, GLASS_SETTINGS.refraction),
    tint: readNumber(record.tint, GLASS_SETTINGS.tint),
    rim: typeof record.rim === "boolean" ? record.rim : GLASS_SETTINGS.rim.default,
  };
};

/** A tint percentage as the two-digit hex alpha appended to the surface colour. */
export const glassTintAlpha = (tint: number): string => {
  const alpha = Math.round((Math.min(100, Math.max(0, tint)) / 100) * 255);
  return alpha.toString(16).toUpperCase().padStart(2, "0");
};
