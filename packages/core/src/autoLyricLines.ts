/**
 * The lyrics Wave shows on Android Auto's player screen with the Lyrics
 * toggle in its overflow menu on, word by word: the chunk of the synced line
 * holding the word being sung in place of the title, and what comes next in
 * place of the artist. The cover stays.
 */
import { currentLyricWordIndex, karaokeLyricLines } from "./karaoke.ts";
import { currentLyricIndex, type LyricLine, type Lyrics } from "./lyrics.ts";

export interface AutoLyricLinesInput {
  /** The Lyrics toggle on Auto's player screen. */
  readonly on: boolean;
  /** Whether Android Auto is connected. */
  readonly carConnected: boolean;
  /** The current track's lyrics (Core's `pickLyrics`); null while they are read. */
  readonly lyrics: Lyrics | null;
  /** Where the current track is. */
  readonly positionMs: number;
}

/** What the now-playing title and artist show in place of the track's own. */
export interface AutoLyricsText {
  /** The chunk of the sung line holding the word being sung, as the title. */
  readonly title: string;
  /**
   * What comes next, as the artist: the line's next chunk, or the next sung
   * line's first; null keeps the track's own artist (on the last chunk of the
   * last sung line).
   */
  readonly artist: string | null;
}

export interface AutoLyricLines {
  /** The lyrics to show as the title and artist, or null for the track's own. */
  readonly text: AutoLyricsText | null;
  /** The position at which `text` changes next while playing on, or null if it won't. */
  readonly nextChangeMs: number | null;
}

const REAL: AutoLyricLines = { text: null, nextChangeMs: null };

/**
 * The longest chunk of a sung line that shows in one field; a longer line
 * shows in chunks. To be tuned once seen in the car.
 */
export const AUTO_LYRIC_LINE_MAX = 30;

/** Lines sung together share the one line, joined by this. */
const TOGETHER = " / ";

/** Characters as a reader counts them (code points), not UTF-16 units. */
const characters = (text: string): number => [...text].length;

/** A word of a line as written: its text and its UTF-16 offsets in the line's `text`. */
interface Token {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

/** A piece of a line that fits a field: its text and the tokens it holds, `[from, to)`. */
interface Chunk {
  readonly text: string;
  readonly from: number;
  readonly to: number;
}

/**
 * [tokens] packed into as few pieces as the limit allows, as even as they can
 * be: the narrowest width that still needs no more pieces than packing to the
 * limit does. A word longer than the limit is a piece of its own.
 */
const balancedPieces = (tokens: readonly Token[]): Token[][] => {
  const pack = (width: number): Token[][] => {
    const pieces: Token[][] = [];
    let length = 0;
    for (const token of tokens) {
      const piece = pieces.at(-1);
      const size = characters(token.text);
      if (piece !== undefined && length + 1 + size <= width) {
        piece.push(token);
        length += 1 + size;
      } else {
        pieces.push([token]);
        length = size;
      }
    }
    return pieces;
  };
  const fewest = pack(AUTO_LYRIC_LINE_MAX);
  const total = tokens.reduce((sum, token) => sum + characters(token.text), tokens.length - 1);
  for (let width = Math.ceil(total / fewest.length); width < AUTO_LYRIC_LINE_MAX; width += 1) {
    const pieces = pack(width);
    if (pieces.length <= fewest.length) return pieces;
  }
  return fewest;
};

/**
 * [text] (a line, lines sung together split by line breaks) in chunks of up
 * to `AUTO_LYRIC_LINE_MAX` characters, broken between words. Each line sung
 * together is chunked on its own, and the chunks where two of them meet share
 * a field (`Me / You`) when they fit in one.
 */
const chunksOf = (text: string): Chunk[] => {
  const chunks: Chunk[] = [];
  let index = 0;
  for (const part of partsOf(text)) {
    const pieces = balancedPieces(part).map((piece) => {
      const from = index;
      index += piece.length;
      return { text: piece.map((token) => token.text).join(" "), from, to: index };
    });
    const last = chunks.at(-1);
    const first = pieces[0];
    if (last !== undefined && first !== undefined) {
      const joined = last.text + TOGETHER + first.text;
      if (characters(joined) <= AUTO_LYRIC_LINE_MAX) {
        chunks[chunks.length - 1] = { text: joined, from: last.from, to: first.to };
        pieces.shift();
      }
    }
    chunks.push(...pieces);
  }
  return chunks;
};

/** The words of each line sung together in [text], in order. */
const partsOf = (text: string): Token[][] => {
  const parts: Token[][] = [];
  let offset = 0;
  for (const row of text.split("\n")) {
    const tokens = [...row.matchAll(/\S+/g)].map((match) => ({
      text: match[0],
      start: offset + match.index,
      end: offset + match.index + match[0].length,
    }));
    if (tokens.length > 0) parts.push(tokens);
    offset += row.length + 1;
  }
  return parts;
};

/** The first sung line after `index`; -1 when there is none. */
const nextSungIndex = (lines: readonly LyricLine[], index: number): number => {
  for (let at = index + 1; at < lines.length; at += 1) {
    if (/\S/.test(lines[at]!.text)) return at;
  }
  return -1;
};

/**
 * What the title and artist show at `positionMs`. Lyrics only show with the
 * toggle on while Auto is connected: the phone's notification and lock screen
 * share the title and artist, so they get the real ones back once Auto
 * disconnects. Only synced lyrics show; before the first line and in a pause
 * between lines (an empty line) the real title and artist do.
 *
 * The sung line shows in chunks of up to `AUTO_LYRIC_LINE_MAX` characters,
 * broken between words and as even as they can be. The title is the chunk
 * holding the word being sung (Karaoke's word timings: real where the lyrics
 * stamp them, estimated elsewhere), and it moves on once the next chunk's
 * first word starts. The artist is the chunk after it, or on the line's last
 * chunk the next sung line's first one, skipping pauses; on the last chunk of
 * the last sung line it is the real artist.
 */
export const autoLyricLines = ({
  on,
  carConnected,
  lyrics,
  positionMs,
}: AutoLyricLinesInput): AutoLyricLines => {
  if (!on || !carConnected || lyrics?.kind !== "synced") return REAL;
  const { lines } = lyrics;
  const index = currentLyricIndex(lines, positionMs);
  const lineEndMs = lines[index + 1]?.timeMs ?? null;
  const line = lines[index];
  const chunks = line === undefined ? [] : chunksOf(line.text);
  if (line === undefined || chunks.length === 0) return { text: null, nextChangeMs: lineEndMs };
  // A line's word timings only need the next line's start.
  const words = karaokeLyricLines(lines.slice(index, index + 2))[0]!.words;
  const tokens = partsOf(line.text).flat();
  const chunkOfWord = words.map((word) => {
    const token = tokens.findIndex((candidate) => candidate.end > word.start);
    return chunks.findIndex((chunk) => chunk.to > token);
  });
  const chunkAt = (atMs: number): number => chunkOfWord[currentLyricWordIndex(words, atMs)] ?? 0;
  const shown = chunkAt(positionMs);
  let nextChangeMs = lineEndMs;
  for (const word of [...words].sort((a, b) => a.timeMs - b.timeMs)) {
    if (word.timeMs <= positionMs) continue;
    if (lineEndMs !== null && word.timeMs >= lineEndMs) break;
    if (chunkAt(word.timeMs) !== shown) {
      nextChangeMs = word.timeMs;
      break;
    }
  }
  const next = nextSungIndex(lines, index);
  const artist =
    chunks[shown + 1]?.text ??
    (next === -1 ? null : (chunksOf(lines[next]!.text)[0]?.text ?? null));
  return { text: { title: chunks[shown]!.text, artist }, nextChangeMs };
};
