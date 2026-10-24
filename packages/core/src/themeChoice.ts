/**
 * Theme colours chosen in Settings: a background for each scheme, a primary
 * (accent) and a secondary (highlight), each from preset swatches. Every other
 * colour is derived from the background so contrast and spacing hold.
 */

import { readStoredRecord } from "./storedJson.ts";
import { luminance, mix, parseHexColour, toOklch, withLuminance } from "./colour.ts";
import { contrastRatio } from "./palette.ts";
import {
  CONTRAST_REQUIREMENTS,
  DEFAULT_THEME,
  NIGHT_SLATE,
  type Theme,
  type ThemeColors,
} from "./theme.ts";

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
    { id: "black", label: "True black", colour: DEFAULT_THEME.dark.background },
    { id: "slate", label: "Slate", colour: NIGHT_SLATE.background },
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

/** A row of Settings › Theme. */
export type ThemeGroup = "light" | "dark" | "primary" | "secondary";

/** The rows that also take a custom colour. */
export type InkGroup = "primary" | "secondary";

/** The id a primary or secondary takes while its custom colour applies. */
export const CUSTOM_INK = "custom";

/**
 * The chosen swatch id of each group, and the custom primary and secondary
 * (`#rrggbb`, or null when none was picked). A custom colour is kept while a
 * preset is chosen, so its swatch can be picked again.
 */
export interface ThemeChoice {
  readonly light: string;
  readonly dark: string;
  /** A primary preset's id, or `CUSTOM_INK` for `customPrimary`. */
  readonly primary: string;
  /** A secondary preset's id, or `CUSTOM_INK` for `customSecondary`. */
  readonly secondary: string;
  readonly customPrimary: string | null;
  readonly customSecondary: string | null;
}

const GROUPS: readonly ThemeGroup[] = ["light", "dark", "primary", "secondary"];

/** Where each ink group keeps its custom colour. */
const CUSTOM_FIELD = { primary: "customPrimary", secondary: "customSecondary" } as const;

const defaultId = (group: ThemeGroup): string => THEME_SWATCHES[group][0]?.id ?? "";

export const DEFAULT_THEME_CHOICE: ThemeChoice = {
  light: defaultId("light"),
  dark: defaultId("dark"),
  primary: defaultId("primary"),
  secondary: defaultId("secondary"),
  customPrimary: null,
  customSecondary: null,
};

const has = (group: ThemeGroup, id: unknown): id is string =>
  THEME_SWATCHES[group].some((swatch) => swatch.id === id);

const isInk = (group: ThemeGroup): group is InkGroup =>
  group === "primary" || group === "secondary";

/** The theme choice from its stored JSON; anything missing or unknown is its default. */
export const readThemeChoice = (stored: string | null): ThemeChoice => {
  const record = readStoredRecord(stored);
  const hex = (group: InkGroup): string | null => {
    const value = record[CUSTOM_FIELD[group]];
    return typeof value === "string" ? parseHexColour(value) : null;
  };
  const customPrimary = hex("primary");
  const customSecondary = hex("secondary");
  const custom = { primary: customPrimary, secondary: customSecondary };
  const pick = (group: ThemeGroup): string => {
    const id = record[group];
    if (isInk(group) && id === CUSTOM_INK && custom[group] !== null) return CUSTOM_INK;
    return has(group, id) ? id : DEFAULT_THEME_CHOICE[group];
  };
  return {
    light: pick("light"),
    dark: pick("dark"),
    primary: pick("primary"),
    secondary: pick("secondary"),
    customPrimary,
    customSecondary,
  };
};

/** Whether `choice` is the shipped theme with no custom colour kept (nothing to reset). */
export const isDefaultThemeChoice = (choice: ThemeChoice): boolean =>
  GROUPS.every((group) => choice[group] === DEFAULT_THEME_CHOICE[group]) &&
  choice.customPrimary === null &&
  choice.customSecondary === null;

/**
 * How close two colours look, in OKLCH. Hue counts in full; lightness and
 * chroma count for half. Used by the launcher and splash ink palette.
 */
export const inkDistance = (a: string, b: string): number => {
  const [x, y] = [toOklch(a), toOklch(b)];
  const hue = 2 * Math.sqrt(x.c * y.c) * Math.sin((x.h - y.h) / 2);
  return Math.hypot(0.5 * (x.l - y.l), 0.5 * (x.c - y.c), hue);
};

const background = (scheme: Scheme, id: string): string =>
  THEME_SWATCHES[scheme].find((swatch) => swatch.id === id)?.colour ??
  DEFAULT_THEME[scheme].background;

/** The token each ink group colours. */
const INK_TOKEN = { primary: "accent", secondary: "highlight" } as const satisfies Record<
  InkGroup,
  keyof ThemeColors
>;

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** The ink a group asks for before readability: its custom colour, or its preset's tone for `scheme`. */
const ink = (choice: ThemeChoice, group: InkGroup, scheme: Scheme): string => {
  const custom = choice[CUSTOM_FIELD[group]];
  if (choice[group] === CUSTOM_INK && custom !== null) return custom;
  const swatch =
    THEME_SWATCHES[group].find((candidate) => candidate.id === choice[group]) ??
    THEME_SWATCHES[group][0];
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
 * The hand-tuned schemes of each mode. The last is the reference the other
 * grounds are derived from: fog in light, Night Slate in dark (true black has
 * no hue to carry over to a tinted ground).
 */
const TUNED: Record<Scheme, readonly ThemeColors[]> = {
  light: [DEFAULT_THEME.light],
  dark: [DEFAULT_THEME.dark, NIGHT_SLATE],
};

/**
 * A hand-tuned scheme on `ground` if there is one; otherwise each neutral
 * keeps the contrast it has against the reference ground, on the same side
 * (lighter or darker), in the new ground's hue. Contrast rather than fixed
 * lightness steps, so cards stand off a very dark ground as well as a pale one.
 */
const deriveNeutrals = (scheme: Scheme, ground: string): Mutable<ThemeColors> => {
  const tuned = TUNED[scheme].find((colours) => colours.background === ground.toLowerCase());
  if (tuned !== undefined) return { ...tuned };
  const base = TUNED[scheme].at(-1) ?? DEFAULT_THEME[scheme];
  const groundY = luminance(ground);
  const groundTone = toOklch(ground);
  const baseTone = toOklch(base.background);
  const result: Mutable<ThemeColors> = { ...base, background: ground };
  for (const token of NEUTRALS) {
    const reference = base[token];
    if (reference === base.background) {
      result[token] = ground;
      continue;
    }
    const ratio = contrastRatio(reference, base.background);
    const lighter = luminance(reference) > luminance(base.background);
    const target = lighter ? ratio * (groundY + 0.05) - 0.05 : (groundY + 0.05) / ratio - 0.05;
    const chromaShare = baseTone.c === 0 ? 1 : toOklch(reference).c / baseTone.c;
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
      ink(choice, "primary", name),
      ink(choice, "secondary", name),
    );
  return { light: scheme("light"), dark: scheme("dark") };
};

const markOn = (colour: string): string =>
  contrastRatio(BLACK, colour) >= contrastRatio(WHITE, colour) ? BLACK : WHITE;

/**
 * `choice` with `hex` (`#rrggbb` or `#rgb`, as `parseHexColour` reads it) as
 * the group's custom colour, chosen. Unchanged when `hex` isn't a colour.
 */
export const chooseCustomInk = (choice: ThemeChoice, group: InkGroup, hex: string): ThemeChoice => {
  const colour = parseHexColour(hex);
  if (colour === null) return choice;
  return { ...choice, [group]: CUSTOM_INK, [CUSTOM_FIELD[group]]: colour };
};

/** A custom colour as it would apply in one mode. */
export interface CustomInkPreview {
  /** The colour that applies, readability adjustments included. */
  readonly colour: string;
  /** The mode's background, the colour it has to read on. */
  readonly ground: string;
  /** Whether `colour` was deepened or brightened from the pick to read. */
  readonly adjusted: boolean;
}

/**
 * What a custom colour would apply as in each mode, so the picker shows that
 * rather than the raw pick. A colour that isn't one previews the current theme.
 */
export const customInkPreview = (
  choice: ThemeChoice,
  group: InkGroup,
  hex: string,
): { readonly light: CustomInkPreview; readonly dark: CustomInkPreview } => {
  const theme = themeFor(chooseCustomInk(choice, group, hex));
  const pick = parseHexColour(hex);
  const preview = (scheme: Scheme): CustomInkPreview => {
    const colour = theme[scheme][INK_TOKEN[group]];
    return { colour, ground: theme[scheme].background, adjusted: pick !== null && colour !== pick };
  };
  return { light: preview("light"), dark: preview("dark") };
};

/** A swatch as Settings shows it: the colour it gives, and whether it's chosen. */
export interface ThemeSwatchOption {
  readonly id: string;
  readonly label: string;
  readonly colour: string;
  readonly selected: boolean;
  /** The check mark drawn on it when chosen: black or white, whichever reads better. */
  readonly mark: string;
}

/** The custom swatch that ends the Primary and Secondary rows. */
export interface CustomSwatchOption {
  /** The kept custom colour as picked, where the picker opens; null until one is picked. */
  readonly picked: string | null;
  /** The kept custom colour as it would apply in the scheme; null until one is picked. */
  readonly colour: string | null;
  readonly selected: boolean;
  /** The check mark's colour on `colour`; null with no colour. */
  readonly mark: string | null;
}

export interface ThemeSwatchRow {
  readonly group: ThemeGroup;
  readonly swatches: readonly ThemeSwatchOption[];
  /** The custom swatch; null for the background rows. */
  readonly custom: CustomSwatchOption | null;
}

const customSwatch = (choice: ThemeChoice, group: InkGroup, scheme: Scheme): CustomSwatchOption => {
  const kept = choice[CUSTOM_FIELD[group]];
  const colour = kept === null ? null : customInkPreview(choice, group, kept)[scheme].colour;
  return {
    picked: kept,
    colour,
    selected: choice[group] === CUSTOM_INK,
    mark: colour === null ? null : markOn(colour),
  };
};

/**
 * The four swatch rows for Settings. Primary and secondary swatches show the
 * colour they'd actually take in `scheme`, readability adjustments included,
 * and end with the custom swatch.
 */
export const themeSwatchRows = (choice: ThemeChoice, scheme: Scheme): readonly ThemeSwatchRow[] =>
  GROUPS.map((group) => ({
    group,
    swatches: THEME_SWATCHES[group].map((swatch) => {
      const theme = themeFor({ ...choice, [group]: swatch.id });
      const colour = isInk(group) ? theme[scheme][INK_TOKEN[group]] : theme[group].background;
      return {
        id: swatch.id,
        label: swatch.label,
        colour,
        selected: choice[group] === swatch.id,
        mark: markOn(colour),
      };
    }),
    custom: isInk(group) ? customSwatch(choice, group, scheme) : null,
  }));
