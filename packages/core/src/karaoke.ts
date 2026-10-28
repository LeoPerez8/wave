import type { LyricLine, LyricWord } from "./lyrics.ts";

export interface KaraokeLyricLine extends LyricLine {
  readonly words: readonly LyricWord[];
}

/**
 * Prepare once per song, independently of the phone's Karaoke preference.
 * Estimates divide the line span by Unicode character count, capped at 400ms
 * per character and 8 seconds per line. The same cap supplies the last line's
 * span. Stamped words retain their original times and text offsets.
 */
export const karaokeLyricLines = (lines: readonly LyricLine[]): readonly KaraokeLyricLine[] =>
  lines.map((line, index) => {
    const tokens = [...line.text.matchAll(/\S+/g)];
    const length = tokens.reduce((sum, token) => sum + [...token[0]].length, 0);
    const cap = Math.min(8000, length * 400);
    const span = Math.max(
      0,
      Math.min(cap, (lines[index + 1]?.timeMs ?? line.timeMs + cap) - line.timeMs),
    );
    let used = 0;
    const estimated = tokens.flatMap((token) => {
      const start = token.index;
      const end = start + token[0].length;
      const timeMs = line.timeMs + Math.round((span * used) / length);
      used += [...token[0]].length;
      // A stamp can split a word into syllables, so keep every overlapping part.
      const real = line.words?.filter((word) => word.start < end && word.end > start) ?? [];
      return real.length ? real : [{ timeMs, text: token[0], start, end }];
    });
    return { ...line, words: estimated };
  });

/** The latest word whose start has arrived, or -1 before any word starts. */
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
