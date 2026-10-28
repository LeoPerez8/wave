/**
 * Karaoke (docs/spec.md, "Karaoke"): when each word of a synced line is sung.
 * Enhanced LRC's word stamps give real times (`parseLyrics` keeps them on
 * `LyricLine.words`); the other words get estimated ones. Android Auto's word
 * by word lyrics reuse these, whatever the Lyrics view's Karaoke button says.
 */
import type { LyricLine, LyricWord } from "./lyrics.ts";

/** A synced line with a time for every word: real ones where stamped, estimated elsewhere. */
export interface KaraokeLyricLine extends LyricLine {
  readonly words: readonly LyricWord[];
}

/** The longest an estimated character lasts, so an instrumental gap isn't spread over a line. */
const MAX_MS_PER_CHARACTER = 400;
/** The longest a line's estimated words span. */
const MAX_LINE_MS = 8_000;

/** Characters as a reader counts them (code points), not UTF-16 units. */
const characters = (text: string): number => [...text].length;

/**
 * [lines] with every word timed. A stamped word keeps its time; an unstamped
 * word shares the line's span (its start to the next line's, or the cap on the
 * last line) with the line's other words by their length. The span is capped
 * at 400 ms a character and 8 s a line, so an instrumental gap after the last
 * word isn't spread over the words. An estimate never comes before the word
 * ahead of it, so lines sung together (one stamped, one not) light in order.
 */
export const karaokeLyricLines = (lines: readonly LyricLine[]): readonly KaraokeLyricLine[] =>
  lines.map((line, index) => {
    const tokens = [...line.text.matchAll(/\S+/g)];
    const length = tokens.reduce((sum, token) => sum + characters(token[0]), 0);
    const cap = Math.min(MAX_LINE_MS, length * MAX_MS_PER_CHARACTER);
    const next = lines[index + 1]?.timeMs ?? Infinity;
    const span = Math.max(0, Math.min(cap, next - line.timeMs));
    const words: LyricWord[] = [];
    let used = 0;
    for (const token of tokens) {
      const start = token.index;
      const end = start + token[0].length;
      // A stamp can split a word into syllables: keep every stamped part of it.
      const stamped = line.words?.filter((word) => word.start < end && word.end > start) ?? [];
      if (stamped.length > 0) {
        words.push(...stamped);
      } else {
        const estimate = line.timeMs + Math.round((span * used) / length);
        const timeMs = Math.max(estimate, words.at(-1)?.timeMs ?? estimate);
        words.push({ timeMs, text: token[0], start, end });
      }
      used += characters(token[0]);
    }
    return { ...line, words };
  });

/**
 * The word of a line's [words] being sung at [positionMs]: the latest one
 * whose start has come (the last of those sharing a time), or -1 before the
 * first word starts. A seek either way gives the right word at once.
 */
export const currentLyricWordIndex = (
  words: readonly { readonly timeMs: number }[],
  positionMs: number,
): number => {
  "worklet";
  let found = -1;
  let latest = -Infinity;
  for (let index = 0; index < words.length; index += 1) {
    const time = words[index]!.timeMs;
    if (time <= positionMs && time >= latest) {
      found = index;
      latest = time;
    }
  }
  return found;
};
