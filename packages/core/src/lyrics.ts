/**
 * Lyrics for the Now Playing Lyrics view: LRC parsing (synced lyrics) and
 * plain text (unsynced lyrics).
 */

/** One synced line: shown from `timeMs` until the next line's time. */
export interface LyricLine {
  readonly timeMs: number;
  readonly text: string;
}

export type Lyrics =
  | { readonly kind: "synced"; readonly lines: readonly LyricLine[] }
  | { readonly kind: "unsynced"; readonly lines: readonly string[] }
  | { readonly kind: "none" };

/** `[mm:ss]`, `[mm:ss.x]`, `[mm:ss.xx]` or `[mm:ss.xxx]`; some taggers use `:` or `,` for the dot. */
const STAMP = /^\[(\d+):(\d{1,2})(?:[.:,](\d{1,3}))?\]/;
/** Enhanced LRC's per-word timings, `<mm:ss.xx>`. */
const WORD_STAMP = /<\d+:\d{1,2}(?:[.:,]\d{1,3})?>/g;
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
    for (const timeMs of times) lines.push({ timeMs, text: words });
  }
  if (lines.length === 0) {
    const plain = trimBlankEdges(rows);
    return plain.length === 0 ? { kind: "none" } : { kind: "unsynced", lines: plain };
  }
  const shifted = lines.map((line) => ({
    timeMs: Math.max(0, line.timeMs - offsetMs),
    text: line.text,
  }));
  // Stable, so lines sharing a time keep the order they were written in.
  shifted.sort((a, b) => a.timeMs - b.timeMs);
  const merged: LyricLine[] = [];
  for (const line of shifted) {
    const previous = merged.at(-1);
    if (previous?.timeMs === line.timeMs) {
      const joined = [previous.text, line.text].filter((part) => part !== "").join("\n");
      merged[merged.length - 1] = { timeMs: line.timeMs, text: joined };
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
