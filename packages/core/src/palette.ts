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
 * One colour of a ground gradient, at a fraction of its height: 0 is the top,
 * 1 the foot.
 */
export interface GroundStop {
  readonly color: string;
  readonly at: number;
}

/** A top-to-bottom ground gradient: its stops in order, from 0 to 1. */
export type GroundGradient = readonly GroundStop[];

/** An amount for each scheme, from 0 to 1. */
export interface SchemeAmount {
  readonly dark: number;
  readonly light: number;
}

/**
 * How a ground fades from the artwork's colour into the theme's ground.
 * Now Playing's is `NOW_PLAYING_FADE`; a shorter, subtler fade is the same
 * shape with other numbers.
 */
export interface GroundFade {
  /** How far the main colour is toned toward black in dark mode, white in light. */
  readonly tone: SchemeAmount;
  /** How far the toned main colour is then mixed toward the ground: 0 keeps it. */
  readonly soft: number;
  /** Where the fade starts: the main colour lies flat above it. */
  readonly hold: number;
  /** Where the fade reaches the ground, which lies flat below it. */
  readonly reach: number;
  /**
   * The artwork's second colour, passed through on the way down: toned like
   * the main one and blended in at most at [strength], halfway down the fade.
   * Null fades the main colour straight into the ground.
   */
  readonly second: { readonly tone: SchemeAmount; readonly strength: number } | null;
  /**
   * From here down every ink keeps 4.5:1 on the ground: where text sits.
   * Colour above it is toned only as much as needed, the top not at all.
   * 0 guards the whole height, 1 none of it.
   */
  readonly legibleFrom: number;
  /** How many eased steps the fade takes: enough that no band shows. */
  readonly steps: number;
}

/**
 * Now Playing's ground: the main colour lightly toned behind the cover,
 * through the second colour around the title, into the theme's ground three
 * quarters down, where the progress bar and controls sit.
 */
export const NOW_PLAYING_FADE: GroundFade = {
  tone: { dark: 0.15, light: 0.1 },
  soft: 0,
  hold: 0.02,
  reach: 0.75,
  second: { tone: { dark: 0.2, light: 0.15 }, strength: 0.35 },
  // The title's top on the shortest phones, with room to spare.
  legibleFrom: 0.45,
  steps: 12,
};

/**
 * The page-top gradient's look ("Curto bem sutil"): the main colour toned a
 * little, then taken 60% of the way into the theme's ground, fading into it
 * 42% of the screen down with no second colour. Text sits all over a page, so
 * the whole height keeps 4.5:1.
 */
export const PAGE_TOP_FADE: GroundFade = {
  tone: { dark: 0.2, light: 0.12 },
  soft: 0.6,
  hold: 0,
  reach: 0.42,
  second: null,
  legibleFrom: 0,
  steps: 12,
};

/** Which swatch is the main colour, best first: the most vivid one there is. */
const MAIN: readonly Swatch[] = [
  "vibrant",
  "dominant",
  "darkVibrant",
  "lightVibrant",
  "muted",
  "darkMuted",
  "lightMuted",
];

/** Which swatch is the second colour, best first, per scheme. */
const SECOND: Record<GradientTheme["scheme"], readonly Swatch[]> = {
  dark: ["darkVibrant", "darkMuted", "muted", "dominant", "lightVibrant", "lightMuted", "vibrant"],
  light: ["lightVibrant", "lightMuted", "muted", "dominant", "darkVibrant", "darkMuted", "vibrant"],
};

const smoothstep = (t: number): number => t * t * (3 - 2 * t);

const toward = (colour: string, scheme: GradientTheme["scheme"], amount: SchemeAmount): string =>
  mix(colour, scheme === "dark" ? "#000000" : "#ffffff", amount[scheme]);

/** The colour [gradient] draws at [at], between the stops either side of it. */
const colourAt = (gradient: GroundGradient, at: number): string => {
  const after = gradient.findIndex((stop) => stop.at >= at);
  if (after === -1) return gradient[gradient.length - 1]!.color;
  if (after === 0) return gradient[0]!.color;
  const before = gradient[after - 1]!;
  const next = gradient[after]!;
  const span = next.at - before.at;
  return span === 0 ? next.color : mix(before.color, next.color, (at - before.at) / span);
};

/** Every ink reads at 4.5:1 on [gradient] from [from] down. */
const legibleBelow = (gradient: GroundGradient, theme: GradientTheme, from: number): boolean =>
  [colourAt(gradient, from), ...gradient.filter((s) => s.at >= from).map((s) => s.color)].every(
    (colour) => theme.ink.every((ink) => contrastRatio(ink, colour) >= MIN_CONTRAST),
  );

/**
 * The ground's stops for the current artwork: its main colour at the top,
 * eased (smoothstep) into the theme's ground, through its second colour on the
 * way when [fade] has one. Where text sits (`legibleFrom` down) the colours are
 * moved toward the ground the least way that keeps every ink at 4.5:1, easing
 * in from the top so no edge shows. One colour fades into the ground; no
 * palette gives the plain ground, at the same stops.
 */
export const groundGradient = (
  palette: ArtworkPalette | null,
  theme: GradientTheme,
  fade: GroundFade,
): GroundGradient => {
  const main = palette === null ? undefined : pick(palette, MAIN);
  const second =
    palette === null || main === undefined || fade.second === null
      ? undefined
      : pick(palette, SECOND[theme.scheme], main);
  const top =
    main === undefined
      ? theme.ground
      : mix(toward(main, theme.scheme, fade.tone), theme.ground, fade.soft);
  const middle =
    second === undefined || fade.second === null
      ? undefined
      : { colour: toward(second, theme.scheme, fade.second.tone), strength: fade.second.strength };

  const raw: GroundStop[] = fade.hold > 0 ? [{ color: top, at: 0 }] : [];
  for (let step = 0; step <= fade.steps; step++) {
    const t = step / fade.steps;
    const eased = mix(top, theme.ground, smoothstep(t));
    const color =
      middle === undefined || t === 0 || t === 1
        ? eased
        : mix(eased, middle.colour, middle.strength * Math.sin(Math.PI * t));
    raw.push({ color, at: fade.hold + (fade.reach - fade.hold) * t });
  }
  if (fade.reach < 1) raw.push({ color: theme.ground, at: 1 });

  if (main === undefined || fade.legibleFrom >= 1) return raw;
  // How much of the toning each stop takes: none at the top, all of it where text sits.
  const weight = (at: number): number =>
    fade.legibleFrom <= 0 || at >= fade.legibleFrom ? 1 : smoothstep(at / fade.legibleFrom);
  for (let step = 0; step <= TONE_STEPS; step++) {
    const amount = step / TONE_STEPS;
    const toned = raw.map((stop) => ({
      color: mix(stop.color, theme.ground, amount * weight(stop.at)),
      at: stop.at,
    }));
    if (legibleBelow(toned, theme, fade.legibleFrom)) return toned;
  }
  return raw.map((stop) => ({
    color: weight(stop.at) === 1 ? theme.ground : stop.color,
    at: stop.at,
  }));
};

/**
 * The Now Playing ground as drawn: an opaque [base] gradient and, while the
 * colours change, the [incoming] one fading in over it (null once nothing is
 * fading). Two plain layers, so the fade costs an opacity, not a redraw.
 */
export interface GroundLayers {
  readonly base: GroundGradient;
  readonly incoming: GroundGradient | null;
}

/** The stops of [a] and [b] together, each place once, top to bottom. */
const sharedStops = (a: GroundGradient, b: GroundGradient): number[] =>
  [...new Set([...a, ...b].map((stop) => stop.at))].sort((x, y) => x - y);

/**
 * The ground's layers once its colours change to [target], with the incoming
 * layer at opacity [progress] (0 to 1). The fade starts from what is on
 * screen, mid-fade too: the two layers blended where they are, at every stop
 * either has. [instant] (out of sight, reduced motion) shows [target] at once.
 */
export const crossfadeGround = (
  shown: GroundLayers,
  target: GroundGradient,
  progress: number,
  instant: boolean,
): GroundLayers => {
  if (instant) return { base: target, incoming: null };
  const { base, incoming } = shown;
  if (incoming === null) return { base, incoming: target };
  const amount = Math.min(1, Math.max(0, progress));
  return {
    base: sharedStops(base, incoming).map((at) => ({
      color: mix(colourAt(base, at), colourAt(incoming, at), amount),
      at,
    })),
    incoming: target,
  };
};

/** Whether two grounds draw the same: the same colours at the same stops. */
export const sameGround = (a: GroundGradient, b: GroundGradient): boolean =>
  a.length === b.length &&
  a.every(
    (stop, i) => stop.at === b[i]!.at && stop.color.toLowerCase() === b[i]!.color.toLowerCase(),
  );

/**
 * Faintest 8-bit ink alpha that keeps synced lyrics at 3:1 on every stop.
 * Pass the current theme's foreground ink and the colours of its toned Now
 * Playing ground. Full ink is the fallback for an unready theme or a ground
 * that cannot reach 3:1.
 */
export const lyricsDimOpacity = (stops: readonly string[], ink: string): number => {
  if (!HEX.test(ink) || !stops.every((stop) => HEX.test(stop))) return 1;
  for (let alpha = 1; alpha < 255; alpha++) {
    const opacity = alpha / 255;
    if (stops.every((stop) => contrastRatio(mix(stop, ink, opacity), stop) >= 3)) return opacity;
  }
  return 1;
};
