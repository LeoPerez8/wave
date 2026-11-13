/**
 * Now Playing's scrolling lines (docs/spec.md, "Now Playing's long names"):
 * a title, artist or album too long for its line rests at its start, then
 * scrolls in a continuous loop (its start following its end after a gap) back
 * to where it began, and repeats. The lines that overflow start together and
 * rest together, the rest waiting for the longest to finish.
 */

/** The cycle at Android's animator duration scale 1. */
export const MARQUEE = {
  /** How long a line rests at its start before each scroll. */
  restMs: 3000,
  /** The scroll's pace, in dp a second. */
  dpPerSecond: 30,
  /** The space between the text's end and its start coming round again, in dp. */
  gap: 32,
  /** How wide the edges fade the text out, in dp. */
  fadeLength: 24,
} as const;

/** A line's natural text width and the width it has, in dp. */
export type MarqueeLineSize = { readonly text: number; readonly box: number };

/** How one overflowing line moves in each cycle, after the shared rest. */
export type MarqueeLine = {
  /** How far it scrolls: its text's width plus the gap, landing back at its start. */
  readonly travel: number;
  readonly scrollMs: number;
  /** How long it waits at its start, after scrolling, for the longest line to finish. */
  readonly idleMs: number;
};

export type MarqueePlan = {
  readonly restMs: number;
  /** The rest plus the longest line's scroll: every moving line repeats on this. */
  readonly cycleMs: number;
  /** Per line, in order; null for one that fits or isn't measured yet. */
  readonly lines: readonly (MarqueeLine | null)[];
};

/** A text this much wider than its box (sub-pixel rounding) still counts as fitting. */
const FITS_WITHIN = 1;

/** Android's animator duration scale, as times are stretched by it; an unreadable one is 1. */
const durationScale = (scale: number): number => (Number.isFinite(scale) && scale >= 0 ? scale : 1);

/**
 * Whether the lines hold still, ending in an ellipsis as they did before:
 * with reduce motion on, or Android's animations removed (scale 0).
 */
export const marqueeStill = ({
  reduceMotion,
  animatorScale,
}: {
  readonly reduceMotion: boolean;
  readonly animatorScale: number;
}): boolean => reduceMotion || durationScale(animatorScale) === 0;

/**
 * How Now Playing's lines move, given each one's size (null until measured)
 * and Android's animator duration scale, which stretches every time as it
 * does Android's own animations. Null when nothing moves: every line fits,
 * or animations are removed.
 */
export const marqueePlan = (
  sizes: readonly (MarqueeLineSize | null)[],
  animatorScale: number,
): MarqueePlan | null => {
  const scale = durationScale(animatorScale);
  if (scale === 0) return null;
  const scrolls = sizes.map((size) =>
    size === null || size.text - size.box <= FITS_WITHIN
      ? null
      : {
          travel: size.text + MARQUEE.gap,
          scrollMs: ((size.text + MARQUEE.gap) / MARQUEE.dpPerSecond) * 1000 * scale,
        },
  );
  const longest = Math.max(0, ...scrolls.map((line) => line?.scrollMs ?? 0));
  if (longest === 0) return null;
  const restMs = MARQUEE.restMs * scale;
  return {
    restMs,
    cycleMs: restMs + longest,
    lines: scrolls.map((line) =>
      line === null ? null : { ...line, idleMs: longest - line.scrollMs },
    ),
  };
};

/**
 * How far [line] has moved from its start, in dp, at [elapsedMs] on the
 * group's one clock since the lines started (it wraps every cycle): still for
 * the rest, then a whole loop at a steady pace, then still at its start until
 * the longest line has finished. Every line reads the same clock, so they
 * never drift apart. A worklet, for the lines' styles on the UI thread.
 */
export const marqueeOffset = (
  plan: MarqueePlan | null,
  line: MarqueeLine | null,
  elapsedMs: number,
): number => {
  "worklet";
  if (plan === null || line === null || plan.cycleMs <= 0 || line.scrollMs <= 0) return 0;
  const moving = (elapsedMs % plan.cycleMs) - plan.restMs;
  if (moving <= 0 || moving >= line.scrollMs) return 0;
  return (moving / line.scrollMs) * line.travel;
};

/**
 * Hebrew, Arabic, Syriac, Thaana, N'Ko and the other right-to-left scripts,
 * with their presentation forms, and the right-to-left blocks beyond the
 * Basic Multilingual Plane (Adlam, Hanifi Rohingya, Mende Kikakui and more).
 */
const RIGHT_TO_LEFT =
  /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF\u{10800}-\u{10FFF}\u{1E800}-\u{1EFFF}]/u;
/** A letter of any script: the first one decides the text's direction. */
const LETTER = /\p{L}/u;

/**
 * Whether [text] reads right to left, by its first letter (digits and
 * punctuation have no direction), so its line scrolls the other way: resting
 * on its right end and moving right.
 */
export const readsRightToLeft = (text: string): boolean => {
  for (const char of text) {
    if (LETTER.test(char)) return RIGHT_TO_LEFT.test(char);
  }
  return false;
};
