/**
 * The Now Playing background: a gradient taken from the artwork's palette,
 * toned so the app's own text and controls stay readable on it.
 */

type Rgb = readonly [number, number, number];

const parseHex = (hex: string): Rgb => {
  const value = Number.parseInt(hex.slice(1, 7), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
};

const linear = (channel: number): number => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

const luminance = (hex: string): number => {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
};

/** An artwork palette (Android Palette swatches) as `#rrggbb`; any may be missing. */
export interface ArtworkPalette {
  readonly dominant?: string | undefined;
  readonly vibrant?: string | undefined;
  readonly darkVibrant?: string | undefined;
  readonly lightVibrant?: string | undefined;
  readonly muted?: string | undefined;
  readonly darkMuted?: string | undefined;
  readonly lightMuted?: string | undefined;
}

/** The screen's ground and the colours set on the gradient, all `#rrggbb`. */
export interface GradientTheme {
  readonly scheme: "light" | "dark";
  readonly ground: string;
  /** Text and control colours that must stay readable on both stops. */
  readonly ink: readonly string[];
}

export interface Gradient {
  readonly top: string;
  readonly bottom: string;
}

type Swatch = keyof ArtworkPalette;

const HEX = /^#[0-9a-f]{6}$/i;

/** Which swatches each stop prefers, best first, per theme. */
const PREFERENCE: Record<GradientTheme["scheme"], { top: Swatch[]; bottom: Swatch[] }> = {
  dark: {
    top: ["darkVibrant", "vibrant", "dominant", "muted", "darkMuted"],
    bottom: ["darkMuted", "muted", "dominant", "darkVibrant"],
  },
  light: {
    top: ["lightVibrant", "lightMuted", "vibrant", "dominant", "muted"],
    bottom: ["lightMuted", "muted", "dominant", "lightVibrant"],
  },
};

const pick = (
  palette: ArtworkPalette,
  order: readonly Swatch[],
  except?: string,
): string | undefined =>
  order
    .map((swatch) => palette[swatch])
    .find(
      (colour): colour is string =>
        typeof colour === "string" &&
        HEX.test(colour) &&
        colour.toLowerCase() !== except?.toLowerCase(),
    );

/** Text needs 4.5:1 (WCAG AA); controls get the same so the teal never fades out. */
const MIN_CONTRAST = 4.5;

/** How finely a swatch is toned toward the ground, as a fraction of the way. */
const TONE_STEPS = 20;

const toHex = (rgb: Rgb): string =>
  `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;

const mix = (from: string, to: string, amount: number): string => {
  const [r1, g1, b1] = parseHex(from);
  const [r2, g2, b2] = parseHex(to);
  return toHex([r1 + (r2 - r1) * amount, g1 + (g2 - g1) * amount, b1 + (b2 - b1) * amount]);
};

/** The swatch moved the least way toward the ground that keeps every ink readable on it. */
const tone = (colour: string, theme: GradientTheme): string => {
  for (let step = 0; step < TONE_STEPS; step++) {
    const toned = mix(colour, theme.ground, step / TONE_STEPS);
    if (theme.ink.every((ink) => contrastRatio(ink, toned) >= MIN_CONTRAST)) return toned;
  }
  return theme.ground;
};

/** The two-stop background for the current artwork (the plain ground without a palette). */
export const paletteGradient = (palette: ArtworkPalette | null, theme: GradientTheme): Gradient => {
  const order = PREFERENCE[theme.scheme];
  const top = palette === null ? undefined : pick(palette, order.top);
  // A palette of one colour fades from it into the ground rather than lying flat.
  const bottom = palette === null ? undefined : pick(palette, order.bottom, top);
  return {
    top: top === undefined ? theme.ground : tone(top, theme),
    bottom: bottom === undefined ? theme.ground : tone(bottom, theme),
  };
};

/** WCAG contrast ratio between two `#rrggbb` colours, from 1 to 21. */
export const contrastRatio = (a: string, b: string): number => {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

/**
 * The Now Playing ground as drawn: an opaque [base] gradient and, while the
 * colours change, the [incoming] one fading in over it (null once nothing is
 * fading). Two plain layers, so the fade costs an opacity, not a redraw.
 */
export interface GroundLayers {
  readonly base: Gradient;
  readonly incoming: Gradient | null;
}

/**
 * The ground's layers once its colours change to [target], with the incoming
 * layer at opacity [progress] (0 to 1). The fade starts from what is on
 * screen, mid-fade too: the two layers blended where they are, which is itself
 * a two-stop gradient. [instant] (out of sight, reduced motion) shows [target]
 * at once.
 */
export const crossfadeGround = (
  shown: GroundLayers,
  target: Gradient,
  progress: number,
  instant: boolean,
): GroundLayers => {
  if (instant) return { base: target, incoming: null };
  const { base, incoming } = shown;
  if (incoming === null) return { base, incoming: target };
  const amount = Math.min(1, Math.max(0, progress));
  return {
    base: {
      top: mix(base.top, incoming.top, amount),
      bottom: mix(base.bottom, incoming.bottom, amount),
    },
    incoming: target,
  };
};
