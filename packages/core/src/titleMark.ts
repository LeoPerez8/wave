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

/** The space between the waves and the word, in ems: one 8dp cell at the large title's 26dp. */
const GAP = 8 / 26;

/** Home's waves take this share of the word's capital height. */
const WAVE_HEIGHT_OF_CAPS = 0.6;

/** About how wide "Wave" sets in Inter Light, in ems, rounded up so the fit errs small. */
const WORD = 2.75;

/** The title's type at the standard font scale, in dp. */
export interface TitleMarkType {
  readonly fontSize: number;
  readonly lineHeight: number;
}

/**
 * The title's line as the phone drew it, in dp: what the text's layout reports
 * for it. Android scales large text by less than the font scale, so only the
 * drawn line says how tall the word is.
 */
export interface TitleLine {
  /** How tall the capitals are. */
  readonly capHeight: number;
  /** The line's height. */
  readonly height: number;
  /** How far down the line its baseline is. */
  readonly baseline: number;
}

/** Where the waves sit beside the title's text, in dp. */
export interface TitleMarkLayout {
  readonly width: number;
  /** The approved share of the title's capitals' height. */
  readonly height: number;
  /** The waves' stroke width. */
  readonly stroke: number;
  /** The space between the waves and the word. */
  readonly gap: number;
  /** How far above the bottom of the title's line the waves rest: on its baseline. */
  readonly baseline: number;
}

/** The waves beside a drawn line: 60% of its capitals' height, on its baseline. */
const layoutBeside = ({ capHeight, height, baseline }: TitleLine): TitleMarkLayout => {
  const waveHeight = capHeight * WAVE_HEIGHT_OF_CAPS;
  const scale = waveHeight / LOGO_SIZE.height;
  return {
    width: LOGO_SIZE.width * scale,
    height: waveHeight,
    stroke: LOGO_WAVES.stroke * scale,
    // The gap is a share of the font size, which the capitals give.
    gap: (GAP / INTER.capHeight) * capHeight,
    baseline: height - baseline,
  };
};

/**
 * The waves beside a title set in Inter at `fontSize`, from the font's own
 * metrics: 60% of its capitals' height and resting on its baseline, so they
 * read as part of the word. Right where the phone draws the type at that
 * size, as it does at the standard font scale.
 */
export const titleMarkLayout = ({ fontSize, lineHeight }: TitleMarkType): TitleMarkLayout => {
  // The font's own line box sits centred in the line height.
  const lineBox = (INTER.ascender + INTER.descender) * fontSize;
  const descent = INTER.descender * fontSize + (lineHeight - lineBox) / 2;
  return layoutBeside({
    capHeight: INTER.capHeight * fontSize,
    height: lineHeight,
    baseline: lineHeight - descent,
  });
};

/** What decides where Home's waves go. */
export interface TitleMarkDrawn {
  /** The title's line as drawn, once the phone has laid it out. */
  readonly line: TitleLine | undefined;
  /** The phone's font scale. */
  readonly fontScale: number;
  /** The title's type at the standard font scale. */
  readonly type: TitleMarkType;
}

/**
 * Where the waves go beside the title as the phone drew it. Before the line
 * is measured they take the type's own size at the standard font scale, where
 * that is what the phone draws, and are left out at any other (`undefined`):
 * the size there is the phone's to say, and a guess would show and then jump.
 */
export const titleMarkPlacement = ({
  line,
  fontScale,
  type,
}: TitleMarkDrawn): TitleMarkLayout | undefined => {
  if (line !== undefined) return layoutBeside(line);
  return fontScale === 1 ? titleMarkLayout(type) : undefined;
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
 * The most Home's title may grow, as a multiple of its standard size: the
 * phone's font scale, held where the waves and the word fill the line so
 * neither is cut on a narrow phone, and never held under the standard size.
 * A ceiling, not the drawn size: the phone may draw large text smaller than
 * its font scale says, and then the title is under it with room to spare.
 */
export const titleMarkFontScale = ({ fontScale, fontSize, room }: TitleMarkRoom): number => {
  const { width, gap } = titleMarkLayout({ fontSize, lineHeight: fontSize });
  const fit = room / (width + gap + WORD * fontSize);
  return Math.min(fontScale, Math.max(1, fit));
};
