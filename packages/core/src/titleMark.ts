/**
 * Home's large title: Wave's two waves before the word "Wave", the top wave in
 * the owner's primary and the bottom one in their secondary.
 */

import { LOGO_WAVES } from "./logo.ts";
import { themeFor, type Scheme, type ThemeChoice } from "./themeChoice.ts";
import type { ThemeColors } from "./theme.ts";

/**
 * The theme token each wave takes. The launcher icon snaps the same two
 * colours to its palette, on black; the title sits on the owner's ground, so
 * it takes them as the app shows them there, corrected to read on it.
 */
export const TITLE_MARK_TOKENS = {
  top: "accent",
  bottom: "highlight",
} as const satisfies Record<string, keyof ThemeColors>;

/** The colours of the title's two waves, `#rrggbb`. */
export interface TitleMarkColours {
  readonly top: string;
  readonly bottom: string;
}

/** The waves' colours for a theme choice in `scheme`. */
export const titleMarkColours = (choice: ThemeChoice, scheme: Scheme): TitleMarkColours => {
  const colours = themeFor(choice)[scheme];
  return { top: colours[TITLE_MARK_TOKENS.top], bottom: colours[TITLE_MARK_TOKENS.bottom] };
};

/** Inter's vertical metrics, as fractions of the font size. */
const INTER = { capHeight: 1490 / 2048, ascender: 1984 / 2048, descender: 494 / 2048 } as const;

/** The logo's width and height in its own units, round caps included. */
const LOGO_SIZE = {
  width: 2 + LOGO_WAVES.stroke,
  height: 2 * (LOGO_WAVES.gap + LOGO_WAVES.amplitude) + LOGO_WAVES.stroke,
} as const;

/** The space between the waves and the word, in ems: one 8dp cell at the large title's 36dp. */
const GAP = 8 / 36;

/** About how wide "Wave" sets in Inter Light, in ems, rounded up so the fit errs small. */
const WORD = 2.75;

/** The title's type, in dp at the font scale it is drawn at. */
export interface TitleMarkType {
  readonly fontSize: number;
  readonly lineHeight: number;
}

/** Where the waves sit beside the title's text, in dp. */
export interface TitleMarkLayout {
  readonly width: number;
  /** As tall as the title's capitals. */
  readonly height: number;
  /** The waves' stroke width. */
  readonly stroke: number;
  /** The space between the waves and the word. */
  readonly gap: number;
  /** How far above the bottom of the title's line the waves rest: on its baseline. */
  readonly baseline: number;
}

/**
 * The waves beside a title set in Inter: as tall as its capitals and resting
 * on its baseline, so they read as the word's first letter.
 */
export const titleMarkLayout = ({ fontSize, lineHeight }: TitleMarkType): TitleMarkLayout => {
  const height = INTER.capHeight * fontSize;
  const scale = height / LOGO_SIZE.height;
  // The font's own line box sits centred in the line height.
  const lineBox = (INTER.ascender + INTER.descender) * fontSize;
  return {
    width: LOGO_SIZE.width * scale,
    height,
    stroke: LOGO_WAVES.stroke * scale,
    gap: GAP * fontSize,
    baseline: INTER.descender * fontSize + (lineHeight - lineBox) / 2,
  };
};

/** A phone's font scale and the room Home's title line has for the waves and the word. */
export interface TitleMarkRoom {
  /** The phone's font scale. */
  readonly fontScale: number;
  /** The title's font size at the standard font scale, in dp. */
  readonly fontSize: number;
  /** The line's width without the screen margins and the trailing control, in dp. */
  readonly room: number;
}

/**
 * The font scale Home's title is drawn at: the phone's, held where the waves
 * and the word fill the line so neither is cut on a narrow phone, and never
 * held under the standard size.
 */
export const titleMarkFontScale = ({ fontScale, fontSize, room }: TitleMarkRoom): number => {
  const { width, gap } = titleMarkLayout({ fontSize, lineHeight: fontSize });
  const fit = room / (width + gap + WORD * fontSize);
  return Math.min(fontScale, Math.max(1, fit));
};
