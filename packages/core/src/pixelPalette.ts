/**
 * An artwork's palette from its pixels, for a client with no platform palette (the desktop;
 * the phone uses Android's Palette). It follows Android Palette's targets: the colours are
 * bucketed, near-black, near-white and transparent pixels are left out, the most common
 * bucket is the dominant swatch, and each other swatch is the bucket that best fits its
 * lightness and saturation, no bucket used twice.
 */

import type { ArtworkPalette } from "./palette.ts";

interface Bucket {
  readonly hex: string;
  readonly population: number;
  readonly saturation: number;
  readonly lightness: number;
}

interface Target {
  readonly swatch: Exclude<keyof ArtworkPalette, "dominant">;
  readonly lightness: readonly [min: number, target: number, max: number];
  readonly saturation: readonly [min: number, target: number, max: number];
}

const LIGHT = [0.55, 0.74, 1] as const;
const NORMAL = [0.3, 0.5, 0.7] as const;
const DARK = [0, 0.26, 0.45] as const;
const VIBRANT = [0.35, 1, 1] as const;
const MUTED = [0, 0.3, 0.4] as const;

/** In Android's order, which decides who gets a bucket two targets fit. */
const TARGETS: readonly Target[] = [
  { swatch: "lightVibrant", lightness: LIGHT, saturation: VIBRANT },
  { swatch: "vibrant", lightness: NORMAL, saturation: VIBRANT },
  { swatch: "darkVibrant", lightness: DARK, saturation: VIBRANT },
  { swatch: "lightMuted", lightness: LIGHT, saturation: MUTED },
  { swatch: "muted", lightness: NORMAL, saturation: MUTED },
  { swatch: "darkMuted", lightness: DARK, saturation: MUTED },
];

/** Android's weights: lightness matters most, then saturation and how common the colour is. */
const WEIGHTS = { saturation: 0.24, lightness: 0.52, population: 0.24 } as const;

const hexOf = (r: number, g: number, b: number): string =>
  `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;

const hsl = (r: number, g: number, b: number): { saturation: number; lightness: number } => {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const lightness = (max + min) / 2;
  const spread = max - min;
  const saturation = spread === 0 ? 0 : spread / (1 - Math.abs(2 * lightness - 1));
  return { saturation, lightness };
};

const within = (value: number, [min, , max]: readonly [number, number, number]) =>
  value >= min && value <= max;

/**
 * The palette of an image from its RGBA pixels (`ImageData.data`): `#rrggbb` swatches, any of
 * which may be missing. Pass a small copy of the artwork (64 by 64 is plenty).
 */
export const pixelPalette = (rgba: ArrayLike<number>): ArtworkPalette => {
  // 5 bits a channel, as Android quantizes; each bucket keeps its pixels' sums for an average.
  const sums = new Map<number, [r: number, g: number, b: number, count: number]>();
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const r = rgba[i]!;
    const g = rgba[i + 1]!;
    const b = rgba[i + 2]!;
    if (rgba[i + 3]! < 125) continue;
    const { lightness } = hsl(r, g, b);
    if (lightness <= 0.05 || lightness >= 0.95) continue;
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const sum = sums.get(key);
    if (sum === undefined) sums.set(key, [r, g, b, 1]);
    else {
      sum[0] += r;
      sum[1] += g;
      sum[2] += b;
      sum[3] += 1;
    }
  }
  const buckets: Bucket[] = [...sums.values()].map(([r, g, b, count]) => {
    const [ar, ag, ab] = [r / count, g / count, b / count];
    return { hex: hexOf(ar, ag, ab), population: count, ...hsl(ar, ag, ab) };
  });
  if (buckets.length === 0) return {};
  const dominant = buckets.reduce((best, bucket) =>
    bucket.population > best.population ? bucket : best,
  );
  const used = new Set<Bucket>();
  const palette: { -readonly [K in keyof ArtworkPalette]: string } = { dominant: dominant.hex };
  for (const target of TARGETS) {
    let best: { bucket: Bucket; score: number } | null = null;
    for (const bucket of buckets) {
      if (used.has(bucket)) continue;
      if (!within(bucket.saturation, target.saturation)) continue;
      if (!within(bucket.lightness, target.lightness)) continue;
      const score =
        WEIGHTS.saturation * (1 - Math.abs(bucket.saturation - target.saturation[1])) +
        WEIGHTS.lightness * (1 - Math.abs(bucket.lightness - target.lightness[1])) +
        WEIGHTS.population * (bucket.population / dominant.population);
      if (best === null || score > best.score) best = { bucket, score };
    }
    if (best === null) continue;
    used.add(best.bucket);
    palette[target.swatch] = best.bucket.hex;
  }
  return palette;
};
