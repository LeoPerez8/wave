/**
 * Wave's colour theme ("The Quiet Catalog"): one tonal ramp of blue-grey
 * neutrals (OKLCH hue ~215) that every neutral token picks a step from, plus
 * teal (accent), ember (highlight) and a destructive red. `apps/mobile/global.css`
 * mirrors these values as CSS variables; the app's tests keep the two in sync.
 */

import { contrastRatio } from "./palette.ts";

/**
 * The tone ramp, lightest (`tone-0`) to darkest. Light mode uses `tone-0`–`tone-10`
 * (its text is `tone-10`). `tone-11` is a deeper step that only dark mode uses, so
 * dark mode can go darker without changing light mode's text.
 */
export const TONES = [
  "#eff4f6",
  "#e0ecef",
  "#d3dfe2",
  "#c1cdd0",
  "#a5b0b3",
  "#778385",
  "#606b6e",
  "#454f52",
  "#293235",
  "#1c2628",
  "#121b1d",
  "#0a1113",
] as const;

/** The colour tokens of one scheme, named as in global.css (`--color-<name>`). */
export interface ThemeColors {
  /** The ground of every screen. */
  readonly background: string;
  /** Grouped areas (settings groups). */
  readonly grouped: string;
  /** Cards, and the tint over the glass of what floats. */
  readonly surface: string;
  /** Titles and body text. */
  readonly foreground: string;
  /** Secondary text: artists, counts, helper copy. */
  readonly secondary: string;
  /** Non-text only: disabled icons, placeholder glyphs. */
  readonly tertiary: string;
  /** One-pixel hairlines. */
  readonly separator: string;
  /** The field behind artwork that has no image. */
  readonly fill: string;
  readonly accent: string;
  /** Text and icons laid on an accent fill. */
  readonly "on-accent": string;
  readonly highlight: string;
  readonly destructive: string;
  /** The veil laid (at a quarter strength) over the screen behind a dialog. */
  readonly scrim: string;
}

export interface Theme {
  readonly light: ThemeColors;
  readonly dark: ThemeColors;
}

/**
 * Night Slate: the dark theme Wave shipped before true black, kept as the
 * Slate swatch in Settings and as the reference other tinted dark grounds are
 * derived from. Cards and fills sit one ramp step above its ground, hairlines
 * two (about 0.045 OKLCH lightness per step); grouped areas share the ground.
 */
export const NIGHT_SLATE: ThemeColors = {
  background: TONES[11],
  grouped: TONES[11],
  surface: TONES[10],
  foreground: TONES[1],
  secondary: TONES[4],
  tertiary: TONES[6],
  separator: TONES[9],
  fill: TONES[10],
  accent: "#59c0ad",
  "on-accent": TONES[11],
  highlight: "#ec9d53",
  destructive: "#f2867a",
  scrim: TONES[11],
};

const TRUE_BLACK = "#000000";

/**
 * The shipped theme. Dark mode sits on true black and climbs the ramp from it:
 * grouped areas on the deepest step, cards and fills one above, hairlines one
 * more, so each stands off the ground. Text, accent and highlight are checked
 * against ground, groups and cards by `themeContrastIssues`.
 */
export const DEFAULT_THEME: Theme = {
  light: {
    background: TONES[1],
    grouped: TONES[2],
    surface: TONES[0],
    foreground: TONES[10],
    secondary: TONES[7],
    tertiary: TONES[5],
    separator: TONES[3],
    fill: TONES[2],
    accent: "#006a5f",
    "on-accent": TONES[0],
    highlight: "#a14f09",
    destructive: "#b3261e",
    scrim: TONES[10],
  },
  dark: {
    ...NIGHT_SLATE,
    background: TRUE_BLACK,
    grouped: TONES[11],
    "on-accent": TRUE_BLACK,
    scrim: TRUE_BLACK,
  },
};

type Token = keyof ThemeColors;

/** A colour pair that falls short of the contrast its use needs. */
export interface ContrastIssue {
  readonly ink: Token;
  readonly on: Token;
  readonly ratio: number;
  readonly minimum: number;
}

/** WCAG AA: 4.5:1 for normal text, 3:1 for non-text marks (1.4.11). */
const TEXT = 4.5;
const NON_TEXT = 3;

/** Every pair the app draws, with the contrast it needs. */
export const CONTRAST_REQUIREMENTS: readonly {
  ink: Token;
  on: readonly Token[];
  minimum: number;
}[] = [
  { ink: "foreground", on: ["background", "surface", "grouped"], minimum: TEXT },
  { ink: "secondary", on: ["background", "surface", "grouped"], minimum: TEXT },
  { ink: "tertiary", on: ["background", "surface"], minimum: NON_TEXT },
  { ink: "accent", on: ["background", "surface"], minimum: TEXT },
  { ink: "highlight", on: ["background", "surface"], minimum: TEXT },
  { ink: "destructive", on: ["background", "surface"], minimum: TEXT },
  { ink: "on-accent", on: ["accent"], minimum: TEXT },
];

/** The pairs of a scheme that miss WCAG AA, in a fixed order; empty when it all reads. */
export const themeContrastIssues = (colors: ThemeColors): readonly ContrastIssue[] =>
  CONTRAST_REQUIREMENTS.flatMap(({ ink, on, minimum }) =>
    on.flatMap((ground) => {
      const ratio = contrastRatio(colors[ink], colors[ground]);
      return ratio < minimum ? [{ ink, on: ground, ratio, minimum }] : [];
    }),
  );
