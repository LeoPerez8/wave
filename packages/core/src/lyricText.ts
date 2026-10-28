/** How lyrics count their text: words as written and characters as a reader sees them. */

/** A word of a line as written (a run without spaces): its text and UTF-16 offsets. */
export interface TextWord {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

/** [text]'s words in order, their offsets counted from [offset] (where [text] starts in its line). */
export const textWords = (text: string, offset = 0): TextWord[] =>
  [...text.matchAll(/\S+/g)].map((match) => ({
    text: match[0],
    start: offset + match.index,
    end: offset + match.index + match[0].length,
  }));

/** Characters as a reader counts them (code points), not UTF-16 units. */
export const characterCount = (text: string): number => [...text].length;
