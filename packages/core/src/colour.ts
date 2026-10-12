/**
 * Colour arithmetic for the theme: sRGB hex ⇄ OKLCH, WCAG relative luminance
 * and finding the colour of a hue that has a given luminance.
 */

type Rgb = readonly [number, number, number];

/** OKLCH: perceptual lightness 0–1, chroma, hue in radians. */
export interface Oklch {
  readonly l: number;
  readonly c: number;
  readonly h: number;
}

const linearRgb = (hex: string): Rgb => {
  const [r, g, b] = parseHex(hex);
  return [toLinear(r), toLinear(g), toLinear(b)];
};

const parseHex = (hex: string): Rgb => {
  const value = Number.parseInt(hex.slice(1, 7), 16);
  return [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255];
};

const toHex = (rgb: Rgb): string =>
  `#${rgb
    .map((c) =>
      Math.round(Math.min(1, Math.max(0, c)) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;

const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number): number =>
  c <= 0.0031308 ? c * 12.92 : 1.055 * Math.max(0, c) ** (1 / 2.4) - 0.055;

/** WCAG relative luminance of a `#rrggbb` colour, 0 (black) to 1 (white). */
export const luminance = (hex: string): number => {
  const [r, g, b] = linearRgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export const toOklch = (hex: string): Oklch => {
  const [r, g, b] = linearRgb(hex);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { l: L, c: Math.hypot(A, B), h: Math.atan2(B, A) };
};

/** Linear sRGB of an OKLCH colour; channels may fall outside 0–1 (out of gamut). */
const oklchToLinear = ({ l: L, c, h }: Oklch): Rgb => {
  const A = c * Math.cos(h);
  const B = c * Math.sin(h);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
};

const inGamut = (rgb: Rgb): boolean => rgb.every((c) => c >= -1e-4 && c <= 1 + 1e-4);

const SEARCH_STEPS = 32;

/** The colour, with its chroma lowered as far as needed to fit sRGB. */
const clip = (colour: Oklch): Rgb => {
  const full = oklchToLinear(colour);
  if (inGamut(full)) return full;
  let low = 0;
  let high = colour.c;
  for (let i = 0; i < SEARCH_STEPS; i++) {
    const mid = (low + high) / 2;
    if (inGamut(oklchToLinear({ ...colour, c: mid }))) low = mid;
    else high = mid;
  }
  return oklchToLinear({ ...colour, c: low });
};

const linearLuminance = ([r, g, b]: Rgb): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * The `#rrggbb` colour of the given hue and (at most) chroma whose WCAG
 * luminance is `target` (clamped to 0–1).
 */
export const withLuminance = (target: number, hue: number, chroma: number): string => {
  const goal = Math.min(1, Math.max(0, target));
  let low = 0;
  let high = 1;
  for (let i = 0; i < SEARCH_STEPS; i++) {
    const mid = (low + high) / 2;
    if (linearLuminance(clip({ l: mid, c: chroma, h: hue })) < goal) low = mid;
    else high = mid;
  }
  const [r, g, b] = clip({ l: (low + high) / 2, c: chroma, h: hue });
  return toHex([fromLinear(r), fromLinear(g), fromLinear(b)]);
};

/**
 * [colour] (`#rrggbb`, or `#rrggbbaa` whose alpha is replaced) laid at
 * [opacity] (0–1) as `#rrggbbaa`. Anything else (a theme colour not loaded
 * yet, such as `transparent`) is returned as it is.
 */
export const withOpacity = (colour: string, opacity: number): string => {
  if (!/^#[\da-f]{6}([\da-f]{2})?$/i.test(colour)) return colour;
  const alpha = Math.round(Math.min(1, Math.max(0, opacity)) * 255);
  return `${colour.slice(0, 7)}${alpha.toString(16).padStart(2, "0")}`;
};

/** `from` moved `amount` (0–1) of the way to `to`, in sRGB. */
export const mix = (from: string, to: string, amount: number): string => {
  const [r1, g1, b1] = parseHex(from);
  const [r2, g2, b2] = parseHex(to);
  return toHex([r1 + (r2 - r1) * amount, g1 + (g2 - g1) * amount, b1 + (b2 - b1) * amount]);
};
