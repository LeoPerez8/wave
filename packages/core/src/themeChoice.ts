/**
 * Theme colours chosen in Settings: a background for each scheme, a primary
 * (accent) and a secondary (highlight), each from preset swatches. Every other
 * colour is derived from the background so contrast and spacing hold.
 */

import { readStoredRecord } from "./storedJson.ts";
import { luminance, mix, toOklch, withLuminance } from "./colour.ts";
import { contrastRatio } from "./palette.ts";
import { CONTRAST_REQUIREMENTS, DEFAULT_THEME, type Theme, type ThemeColors } from "./theme.ts";

export type Scheme = "light" | "dark";

/** A background preset. */
export interface BackgroundSwatch {
  readonly id: string;
  readonly label: string;
  readonly colour: string;
}

/** A primary or secondary preset, with a tone for each scheme. */
export interface InkSwatch {
  readonly id: string;
  readonly label: string;
  readonly light: string;
  readonly dark: string;
}

/** The presets of each group; the first of each is the shipped theme. */
export const THEME_SWATCHES: {
  readonly light: readonly BackgroundSwatch[];
  readonly dark: readonly BackgroundSwatch[];
  readonly primary: readonly InkSwatch[];
  readonly secondary: readonly InkSwatch[];
} = {
  light: [
    { id: "fog", label: "Fog", colour: DEFAULT_THEME.light.background },
    { id: "sand", label: "Sand", colour: "#ede6da" },
    { id: "sage", label: "Sage", colour: "#e1eadc" },
    { id: "blush", label: "Blush", colour: "#f1e3e3" },
    { id: "lilac", label: "Lilac", colour: "#e6e3f1" },
    { id: "paper", label: "Paper", colour: "#f5f5f3" },
  ],
  dark: [
    { id: "slate", label: "Slate", colour: DEFAULT_THEME.dark.background },
    { id: "black", label: "True black", colour: "#000000" },
    { id: "graphite", label: "Graphite", colour: "#141414" },
    { id: "navy", label: "Navy", colour: "#0a0f1f" },
    { id: "forest", label: "Forest", colour: "#0a130d" },
    { id: "plum", label: "Plum", colour: "#140c17" },
  ],
  primary: [
    {
      id: "teal",
      label: "Teal",
      light: DEFAULT_THEME.light.accent,
      dark: DEFAULT_THEME.dark.accent,
    },
    { id: "blue", label: "Blue", light: "#1f5fb8", dark: "#7aaef5" },
    { id: "violet", label: "Violet", light: "#5b4bb7", dark: "#a99af0" },
    { id: "green", label: "Green", light: "#2f6b1f", dark: "#8fcf6e" },
    { id: "rose", label: "Rose", light: "#a8325e", dark: "#f08cb0" },
    { id: "lime", label: "Lime", light: "#8cc63f", dark: "#b5e36b" },
  ],
  secondary: [
    {
      id: "ember",
      label: "Ember",
      light: DEFAULT_THEME.light.highlight,
      dark: DEFAULT_THEME.dark.highlight,
    },
    { id: "gold", label: "Gold", light: "#866600", dark: "#e8c454" },
    { id: "coral", label: "Coral", light: "#b2402c", dark: "#f5917e" },
    { id: "magenta", label: "Magenta", light: "#9c2d8a", dark: "#e78fd6" },
    { id: "sky", label: "Sky", light: "#1b6a93", dark: "#7cc4ea" },
    { id: "lemon", label: "Lemon", light: "#f2d22e", dark: "#f5d742" },
  ],
};

/** The chosen swatch id of each group. */
export interface ThemeChoice {
  readonly light: string;
  readonly dark: string;
  readonly primary: string;
  readonly secondary: string;
}

type Group = keyof ThemeChoice;

const GROUPS: readonly Group[] = ["light", "dark", "primary", "secondary"];

const defaultId = (group: Group): string => THEME_SWATCHES[group][0]?.id ?? "";

export const DEFAULT_THEME_CHOICE: ThemeChoice = {
  light: defaultId("light"),
  dark: defaultId("dark"),
  primary: defaultId("primary"),
  secondary: defaultId("secondary"),
};

const has = (group: Group, id: unknown): id is string =>
  THEME_SWATCHES[group].some((swatch) => swatch.id === id);

/** The theme choice from its stored JSON; anything missing or unknown is its default. */
export const readThemeChoice = (stored: string | null): ThemeChoice => {
  const record = readStoredRecord(stored);
  const pick = (group: Group): string => {
    const id = record[group];
    return has(group, id) ? id : DEFAULT_THEME_CHOICE[group];
  };
  return {
    light: pick("light"),
    dark: pick("dark"),
    primary: pick("primary"),
    secondary: pick("secondary"),
  };
};

/** Whether `choice` is the shipped theme (nothing to reset). */
export const isDefaultThemeChoice = (choice: ThemeChoice): boolean =>
  GROUPS.every((group) => choice[group] === DEFAULT_THEME_CHOICE[group]);

const background = (scheme: Scheme, id: string): string =>
  THEME_SWATCHES[scheme].find((swatch) => swatch.id === id)?.colour ??
  DEFAULT_THEME[scheme].background;

type InkGroup = "primary" | "secondary";

/** The token each ink group colours. */
const INK_TOKEN = { primary: "accent", secondary: "highlight" } as const satisfies Record<
  InkGroup,
  keyof ThemeColors
>;

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const ink = (group: InkGroup, id: string, scheme: Scheme): string => {
  const swatch =
    THEME_SWATCHES[group].find((candidate) => candidate.id === id) ?? THEME_SWATCHES[group][0];
  return swatch?.[scheme] ?? DEFAULT_THEME[scheme][INK_TOKEN[group]];
};

/** The neutral tokens, laid out from the background. */
const NEUTRALS = [
  "grouped",
  "surface",
  "fill",
  "separator",
  "foreground",
  "secondary",
  "tertiary",
] as const;

/** Text-like neutrals keep at most this chroma, so a strongly tinted ground doesn't tint the text. */
const MAX_NEUTRAL_CHROMA = 0.05;

/**
 * Each neutral keeps the contrast it has against the shipped ground, on the
 * same side (lighter or darker), in the new ground's hue. Contrast rather than
 * fixed lightness steps, so cards still stand off a true-black ground.
 */
const deriveNeutrals = (scheme: Scheme, ground: string): Mutable<ThemeColors> => {
  const shipped = DEFAULT_THEME[scheme];
  if (ground.toLowerCase() === shipped.background) return { ...shipped };
  const groundY = luminance(ground);
  const groundTone = toOklch(ground);
  const shippedTone = toOklch(shipped.background);
  const result: Mutable<ThemeColors> = { ...shipped, background: ground };
  for (const token of NEUTRALS) {
    const reference = shipped[token];
    if (reference === shipped.background) {
      result[token] = ground;
      continue;
    }
    const ratio = contrastRatio(reference, shipped.background);
    const lighter = luminance(reference) > luminance(shipped.background);
    const target = lighter ? ratio * (groundY + 0.05) - 0.05 : (groundY + 0.05) / ratio - 0.05;
    const chromaShare = shippedTone.c === 0 ? 1 : toOklch(reference).c / shippedTone.c;
    const chroma = Math.min(MAX_NEUTRAL_CHROMA, groundTone.c * chromaShare);
    result[token] = withLuminance(target, groundTone.h, chroma);
  }
  return result;
};

const BLACK = "#000000";
const WHITE = "#ffffff";

/** How finely an ink is pushed toward black or white until it reads. */
const READABLE_STEPS = 40;

/** `colour`, moved the least way toward black (light) or white (dark) that meets `minimum` on every ground. */
const readable = (
  colour: string,
  grounds: readonly string[],
  minimum: number,
  scheme: Scheme,
): string => {
  const extreme = scheme === "light" ? BLACK : WHITE;
  for (let step = 0; step <= READABLE_STEPS; step++) {
    const candidate = mix(colour, extreme, step / READABLE_STEPS);
    if (grounds.every((ground) => contrastRatio(candidate, ground) >= minimum)) return candidate;
  }
  return extreme;
};

/** One scheme's colours for a background, primary and secondary. */
const deriveScheme = (
  scheme: Scheme,
  ground: string,
  accent: string,
  highlight: string,
): ThemeColors => {
  const colours: Mutable<ThemeColors> = {
    ...deriveNeutrals(scheme, ground),
    accent,
    highlight,
    destructive: DEFAULT_THEME[scheme].destructive,
  };
  for (const { ink: token, on, minimum } of CONTRAST_REQUIREMENTS) {
    if (token === "on-accent") continue;
    colours[token] = readable(
      colours[token],
      on.map((under) => colours[under]),
      minimum,
      scheme,
    );
  }
  // Text on an accent fill is the lightest ground (light) or the ground itself (dark).
  colours["on-accent"] = scheme === "light" ? colours.surface : colours.background;
  // The dialog veil darkens: with the text colour in light mode, the ground in dark.
  colours.scrim = scheme === "light" ? colours.foreground : colours.background;
  return colours;
};

/** The full theme for a choice: both schemes, everything derived and readable. */
export const themeFor = (choice: ThemeChoice): Theme => {
  const scheme = (name: Scheme): ThemeColors =>
    deriveScheme(
      name,
      background(name, choice[name]),
      ink("primary", choice.primary, name),
      ink("secondary", choice.secondary, name),
    );
  return { light: scheme("light"), dark: scheme("dark") };
};

const markOn = (colour: string): string =>
  contrastRatio(BLACK, colour) >= contrastRatio(WHITE, colour) ? BLACK : WHITE;

/** A swatch as Settings shows it: the colour it gives, and whether it's chosen. */
export interface ThemeSwatchOption {
  readonly id: string;
  readonly label: string;
  readonly colour: string;
  readonly selected: boolean;
  /** The check mark drawn on it when chosen: black or white, whichever reads better. */
  readonly mark: string;
}

export interface ThemeSwatchRow {
  readonly group: Group;
  readonly swatches: readonly ThemeSwatchOption[];
}

/**
 * The four swatch rows for Settings. Primary and secondary swatches show the
 * colour they'd actually take in `scheme`, readability adjustments included.
 */
export const themeSwatchRows = (choice: ThemeChoice, scheme: Scheme): readonly ThemeSwatchRow[] =>
  GROUPS.map((group) => ({
    group,
    swatches: THEME_SWATCHES[group].map((swatch) => {
      const theme = themeFor({ ...choice, [group]: swatch.id });
      const colour =
        group === "light" || group === "dark"
          ? theme[group].background
          : theme[scheme][INK_TOKEN[group]];
      return {
        id: swatch.id,
        label: swatch.label,
        colour,
        selected: choice[group] === swatch.id,
        mark: markOn(colour),
      };
    }),
  }));
