/** ISRC codes: a Library file's tag as services look it up, and ReccoBeats' rows for them. */
import { djMedianAudioFeatures, type DjAudioFeatures } from "./djMood.ts";

const ISRC = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/;

/**
 * The first valid ISRC in [raw]: upper case, without the hyphens or spaces some taggers write
 * (`US-RC1-76-07839`). A tag can hold several codes split by `;`, `/` or `,`. Null without one.
 */
export const isrcFromTag = (raw: string | null | undefined): string | null => {
  if (raw == null) return null;
  for (const part of raw.split(/[;/,]/)) {
    const code = part.replace(/[\s-]/g, "").toUpperCase();
    if (ISRC.test(code)) return code;
  }
  return null;
};

const unitNumber = (value: unknown): value is number =>
  typeof value === "number" && value >= 0 && value <= 1;

/**
 * ReccoBeats' audio-feature rows (any JSON) as DJ keeps them: per ISRC, the lower median of its
 * valid rows (`djMedianAudioFeatures`). A row without an ISRC, with a feature outside 0 to 1, or
 * with a mode other than 0 or 1 counts for nothing.
 */
export const djAudioFeaturesByIsrc = (
  rows: readonly unknown[],
): ReadonlyMap<string, DjAudioFeatures> => {
  const byIsrc = new Map<string, DjAudioFeatures[]>();
  for (const value of rows) {
    if (typeof value !== "object" || value === null) continue;
    const row = value as Readonly<Record<string, unknown>>;
    const isrc = typeof row.isrc === "string" ? isrcFromTag(row.isrc) : null;
    if (isrc === null) continue;
    if (!unitNumber(row.energy) || !unitNumber(row.valence) || !unitNumber(row.acousticness))
      continue;
    if (row.mode !== 0 && row.mode !== 1) continue;
    const found = byIsrc.get(isrc) ?? [];
    found.push({
      energy: row.energy,
      valence: row.valence,
      acousticness: row.acousticness,
      mode: row.mode,
    });
    byIsrc.set(isrc, found);
  }
  const features = new Map<string, DjAudioFeatures>();
  for (const [isrc, found] of byIsrc) {
    const median = djMedianAudioFeatures(found);
    if (median !== null) features.set(isrc, median);
  }
  return features;
};
