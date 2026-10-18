/**
 * Sharing a song's lyrics as a card (docs/spec.md, "Sharing lyrics"): which
 * lines a tap selects, the colours the card cycles through and the ink that
 * reads on each.
 */
import type { Lyrics } from "./lyrics.ts";
import { contrastRatio, type ArtworkPalette } from "./palette.ts";

/** The most lines a card holds. */
export const MAX_SHARED_LYRIC_LINES = 5;

/** The selected block, by index into the lyrics view's lines, both ends included. */
export interface LyricSelection {
  readonly start: number;
  readonly end: number;
}

/** What a tap on a line leaves selected, and whether it changed anything. */
export interface LyricSelectionTap {
  readonly selection: LyricSelection | null;
  readonly accepted: boolean;
}

/**
 * The lyrics view's lines to pick from ("" for a pause or a gap between
 * verses), in the order it shows them; null when there's nothing to share, so
 * no Share button.
 */
export const shareableLyricLines = (lyrics: Lyrics | null): readonly string[] | null => {
  if (lyrics === null || lyrics.kind === "none") return null;
  const lines =
    lyrics.kind === "synced" ? lyrics.lines.map((line) => line.text) : [...lyrics.lines];
  return lines.some(isWorded) ? lines : null;
};

/** Whether line [index] shows as selected: a worded line in the block. */
export const isLyricLineSelected = (
  lines: readonly string[],
  selection: LyricSelection | null,
  index: number,
): boolean =>
  selection !== null &&
  index >= selection.start &&
  index <= selection.end &&
  isWorded(lines[index]);

/** The block's worded lines, in order: what the card shows. */
export const sharedLyricLines = (
  lines: readonly string[],
  selection: LyricSelection | null,
): string[] =>
  selection === null ? [] : lines.slice(selection.start, selection.end + 1).filter(isWorded);

/** The card's colour for a song without a palette: Wave's graphite (`--color-tone-9`). */
export const LYRIC_CARD_FALLBACK = "#1c2628";

/** The swatches a card cycles through, in order: the dominant colour first, dark before light. */
const CARD_SWATCHES = [
  "dominant",
  "vibrant",
  "darkVibrant",
  "darkMuted",
  "muted",
  "lightVibrant",
  "lightMuted",
] as const satisfies readonly (keyof ArtworkPalette)[];

const HEX = /^#[\da-f]{6}$/i;

/**
 * The colours the card's background cycles through for a cover's [palette],
 * as lowercase `#rrggbb`, each once; the first is the card's to start with.
 */
export const lyricCardColours = (palette: ArtworkPalette | null): string[] => {
  const colours: string[] = [];
  for (const swatch of CARD_SWATCHES) {
    const colour = palette?.[swatch]?.toLowerCase();
    if (colour !== undefined && HEX.test(colour) && !colours.includes(colour)) colours.push(colour);
  }
  return colours.length === 0 ? [LYRIC_CARD_FALLBACK] : colours;
};

/** The colour a tap on the card moves to from [current]: the next one, wrapping round. */
export const nextLyricCardColour = (colours: readonly string[], current: string): string => {
  const at = colours.indexOf(current);
  return colours[(at + 1) % colours.length] ?? current;
};

/** The two inks a card's text can take: white, or Wave's ink (`--color-tone-10`). */
const CARD_INKS = ["#ffffff", "#121b1d"] as const;

/** The card's text colour on [background]: whichever of white and Wave's ink contrasts more. */
export const lyricCardInk = (background: string): string => {
  const [white, ink] = CARD_INKS;
  return contrastRatio(white, background) >= contrastRatio(ink, background) ? white : ink;
};

/**
 * The card's proportions, as fractions of its width: 9:16, with [margin] on
 * every side, the lines set [lineHeight] times their size and given at most
 * [linesHeight] of room.
 */
export const LYRIC_CARD_LAYOUT = {
  aspect: 16 / 9,
  margin: 0.08,
  lineHeight: 1.25,
  linesHeight: 0.95,
} as const;

/** The sizes the lines can take, as fractions of the card's width, largest first. */
export const LYRIC_CARD_TEXT_SIZES = [0.08, 0.07, 0.06, 0.052, 0.045] as const;

/** About how wide a character of the bold face is, as a fraction of its size. */
const CHARACTER_WIDTH = 0.56;

/**
 * The size the card's [lines] are set in, as a fraction of its width: the
 * largest of [LYRIC_CARD_TEXT_SIZES] whose wrapped rows fit their room (the
 * smallest when none does).
 */
export const lyricCardTextSize = (lines: readonly string[]): number => {
  const { margin, lineHeight, linesHeight } = LYRIC_CARD_LAYOUT;
  const width = 1 - 2 * margin;
  const fits = (size: number): boolean => {
    const perRow = Math.max(1, Math.floor(width / (CHARACTER_WIDTH * size)));
    const rows = lines
      .flatMap((line) => line.split("\n"))
      .reduce((total, row) => total + Math.max(1, Math.ceil(row.length / perRow)), 0);
    return rows * size * lineHeight <= linesHeight;
  };
  return LYRIC_CARD_TEXT_SIZES.find(fits) ?? LYRIC_CARD_TEXT_SIZES.at(-1)!;
};

/** What a file name can't hold (or shouldn't, in a gallery), with control characters. */
// oxlint-disable-next-line no-control-regex -- control characters are what it removes
const UNSAFE_NAME = /[\\/:*?"<>|\u0000-\u001f]+/g;

/** The longest title a card's file name keeps. */
const NAME_TITLE_LENGTH = 60;

const two = (n: number): string => String(n).padStart(2, "0");

/** The card's PNG's file name: `Wave - <title> - <yyyyMMdd-HHmmss>.png`, local time. */
export const lyricCardFileName = (title: string | null, at: Date): string => {
  const cleaned = (title ?? "").replace(UNSAFE_NAME, " ").replace(/\s+/g, " ").trim();
  const name = cleaned === "" ? "Lyrics" : cleaned.slice(0, NAME_TITLE_LENGTH).trim();
  const date = `${at.getFullYear()}${two(at.getMonth() + 1)}${two(at.getDate())}`;
  const time = `${two(at.getHours())}${two(at.getMinutes())}${two(at.getSeconds())}`;
  return `Wave - ${name} - ${date}-${time}.png`;
};

/** A line with words: a blank one (a pause, a gap between verses) can't be shared. */
const isWorded = (line: string | undefined): boolean => line !== undefined && line.trim() !== "";

/** The nearest worded line from [from] going [step] (±1), or -1 when there's none. */
const nearestWorded = (lines: readonly string[], from: number, step: 1 | -1): number => {
  for (let at = from; at >= 0 && at < lines.length; at += step) {
    if (isWorded(lines[at])) return at;
  }
  return -1;
};

const wordedCount = (lines: readonly string[], { start, end }: LyricSelection): number =>
  lines.slice(start, end + 1).filter(isWorded).length;

/**
 * A tap on line [index] of [lines] (the view's lines, "" for a blank one) with
 * [selection] selected. A line starts a block, a line next to the block
 * extends it (up to [MAX_SHARED_LYRIC_LINES]) and an end line shrinks it;
 * blank lines are stepped over and don't count. Any other tap does nothing
 * (`accepted` false).
 */
export const tapLyricLine = (
  lines: readonly string[],
  selection: LyricSelection | null,
  index: number,
): LyricSelectionTap => {
  const refused = { selection, accepted: false };
  if (!isWorded(lines[index])) return refused;
  if (selection === null) return { selection: { start: index, end: index }, accepted: true };
  const { start, end } = selection;
  if (index === start && index === end) return { selection: null, accepted: true };
  if (index === start) {
    return { selection: { start: nearestWorded(lines, start + 1, 1), end }, accepted: true };
  }
  if (index === end) {
    return { selection: { start, end: nearestWorded(lines, end - 1, -1) }, accepted: true };
  }
  if (wordedCount(lines, selection) >= MAX_SHARED_LYRIC_LINES) return refused;
  if (index === nearestWorded(lines, start - 1, -1)) {
    return { selection: { start: index, end }, accepted: true };
  }
  if (index === nearestWorded(lines, end + 1, 1)) {
    return { selection: { start, end: index }, accepted: true };
  }
  return refused;
};
