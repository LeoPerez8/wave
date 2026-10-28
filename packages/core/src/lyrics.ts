/**
 * Lyrics for the Now Playing Lyrics view: LRC parsing (synced lyrics) and
 * plain text (unsynced lyrics).
 */

/** A timed word (or a syllable a stamp splits off), placed in its line's stamp-free text. */
export interface LyricWord {
  /** When it starts being sung. */
  readonly timeMs: number;
  readonly text: string;
  /** Its UTF-16 offsets in the line's `text`: `text.slice(start, end)` is the word. */
  readonly start: number;
  readonly end: number;
}

/** One synced line: shown from `timeMs` until the next line's time. */
export interface LyricLine {
  readonly timeMs: number;
  readonly text: string;
  /**
   * Its words as Enhanced LRC's `<mm:ss.xx>` stamps time them; absent on a
   * line without stamps (`karaokeLyricLines` estimates those).
   */
  readonly words?: readonly LyricWord[];
}

export type Lyrics =
  | { readonly kind: "synced"; readonly lines: readonly LyricLine[] }
  | { readonly kind: "unsynced"; readonly lines: readonly string[] }
  | { readonly kind: "none" };

/** `[mm:ss]`, `[mm:ss.x]`, `[mm:ss.xx]` or `[mm:ss.xxx]`; some taggers use `:` or `,` for the dot. */
const STAMP = /^\[(\d+):(\d{1,2})(?:[.:,](\d{1,3}))?\]/;
/** Enhanced LRC's per-word timings, `<mm:ss.xx>`. */
const WORD_STAMP = /<(\d+):(\d{1,2})(?:[.:,](\d{1,3}))?>/g;
/** `[offset:+500]`: shifts every line, in ms; positive shows lines earlier. */
const OFFSET = /^\[offset:\s*([+-]?\d+)\s*\]/i;
/** LRC header tags; only these keys, so section labels like `[Chorus: Jay-Z]` stay lyrics. */
const ID_TAG = /^\[(?:ar|ti|al|au|by|offset|length|re|ve|la|id|#):[^\]]*\]$/i;

const trimBlankEdges = (rows: readonly string[]): string[] => {
  let start = 0;
  let end = rows.length;
  while (start < end && rows[start] === "") start += 1;
  while (end > start && rows[end - 1] === "") end -= 1;
  return rows.slice(start, end);
};

/** A `<mm:ss.xx>` word stamp's time, in ms. */
const wordStampMs = ([, minutes = "0", seconds = "0", fraction = "0"]: RegExpMatchArray): number =>
  Number(minutes) * 60_000 + Number(seconds) * 1000 + Number(fraction.padEnd(3, "0"));

/**
 * The words of [rest] (a row after its line stamps) timed by its Enhanced LRC
 * word stamps, at their places in the stamp-free text; null when it has none.
 * Words before the first stamp start with the line, at [lineMs].
 */
const stampedWords = (rest: string, lineMs: number): LyricWord[] | null => {
  const stamps = [...rest.matchAll(WORD_STAMP)];
  if (stamps.length === 0) return null;
  const clean = rest.replace(WORD_STAMP, "");
  // The shown text is trimmed, so offsets count from its first character.
  let at = -(clean.length - clean.trimStart().length);
  let timeMs = lineMs;
  let from = 0;
  const words: LyricWord[] = [];
  for (const stamp of [...stamps, null]) {
    const segment = rest.slice(from, stamp?.index ?? rest.length);
    for (const token of segment.matchAll(/\S+/g)) {
      const start = at + token.index;
      words.push({ timeMs, text: token[0], start, end: start + token[0].length });
    }
    if (stamp === null) break;
    at += segment.length;
    timeMs = wordStampMs(stamp);
    from = stamp.index + stamp[0].length;
  }
  return words.length > 0 ? words : null;
};

/** Parses lyrics text: LRC with timestamps is synced, anything else is plain text. */
export const parseLyrics = (text: string): Lyrics => {
  const lines: LyricLine[] = [];
  let offsetMs = 0;
  const rows: string[] = [];
  for (const row of text.split(/\r\n|\r|\n/)) {
    const raw = row.trim();
    const offset = OFFSET.exec(raw);
    if (offset !== null) offsetMs = Number(offset[1]);
    // Header tags (`[ar:…]`, `[ti:…]`, `[offset:…]`) are never lyrics.
    if (ID_TAG.test(raw)) continue;
    rows.push(raw);
    let rest = raw;
    const times: number[] = [];
    for (let match = STAMP.exec(rest); match !== null; match = STAMP.exec(rest)) {
      const [stamp, minutes = "0", seconds = "0", fraction = "0"] = match;
      times.push(
        Number(minutes) * 60_000 + Number(seconds) * 1000 + Number(fraction.padEnd(3, "0")),
      );
      rest = rest.slice(stamp.length);
    }
    const words = rest.replace(WORD_STAMP, "").trim();
    const timed = times.length > 0 ? stampedWords(rest, times[0]!) : null;
    for (const timeMs of times) {
      // A repeated line's word stamps are written for its first time.
      const shift = timeMs - times[0]!;
      lines.push(
        timed === null
          ? { timeMs, text: words }
          : {
              timeMs,
              text: words,
              words: timed.map((word) => ({ ...word, timeMs: word.timeMs + shift })),
            },
      );
    }
  }
  if (lines.length === 0) {
    const plain = trimBlankEdges(rows);
    return plain.length === 0 ? { kind: "none" } : { kind: "unsynced", lines: plain };
  }
  const shifted = lines.map((line) => ({
    timeMs: Math.max(0, line.timeMs - offsetMs),
    text: line.text,
    ...(line.words
      ? {
          words: line.words.map((word) => ({
            ...word,
            timeMs: Math.max(0, word.timeMs - offsetMs),
          })),
        }
      : {}),
  }));
  // Stable, so lines sharing a time keep the order they were written in.
  shifted.sort((a, b) => a.timeMs - b.timeMs);
  const merged: LyricLine[] = [];
  for (const line of shifted) {
    const previous = merged.at(-1);
    if (previous?.timeMs === line.timeMs) {
      const joined = [previous.text, line.text].filter((part) => part !== "").join("\n");
      // The later line's words move past the earlier text and the line break.
      const shift = previous.text === "" ? 0 : previous.text.length + 1;
      const words = [
        ...(previous.words ?? []),
        ...(line.words ?? []).map((word) => ({
          ...word,
          start: word.start + shift,
          end: word.end + shift,
        })),
      ];
      merged[merged.length - 1] = {
        timeMs: line.timeMs,
        text: joined,
        ...(words.length ? { words } : {}),
      };
    } else {
      merged.push(line);
    }
  }
  return { kind: "synced", lines: merged };
};

/** A track's lyrics as found: in its tags, and in an `.lrc` file beside it. */
export interface LyricsSources {
  readonly embedded: string | null;
  readonly sidecar: string | null;
}

/**
 * The lyrics to show for a track. Synced beats unsynced; between two synced
 * sources the sidecar `.lrc` wins (it was put there on purpose, often to fix
 * the tags), between two unsynced ones the tags do.
 */
export const pickLyrics = (sources: LyricsSources): Lyrics => {
  const embedded = parseLyrics(sources.embedded ?? "");
  const sidecar = parseLyrics(sources.sidecar ?? "");
  if (sidecar.kind === "synced") return sidecar;
  if (embedded.kind !== "none") return embedded;
  return sidecar;
};

/**
 * The line being sung at `positionMs`: the last one whose time has come, or
 * -1 before the first. `lines` are in time order, as `parseLyrics` returns them.
 */
export const currentLyricIndex = (lines: readonly LyricLine[], positionMs: number): number => {
  "worklet";
  let low = 0;
  let high = lines.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if ((lines[middle]?.timeMs ?? Infinity) <= positionMs) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
};
