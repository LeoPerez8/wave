/**
 * The lyrics Wave draws into the artwork it hands Android Auto, with the
 * Lyrics toggle in the overflow menu of Auto's player screen on: the synced
 * line being sung, big, between the lines before and after it. The title and
 * artist lines stay as they are.
 */
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

/** The three lines drawn into the artwork. */
export interface AutoLyricsFrame {
  /** The line sung before, dimmed above; null when there is none. */
  readonly previous: string | null;
  /** The line being sung, big and bold in the middle. */
  readonly current: string;
  /** The line sung next, dimmed below; null when there is none. */
  readonly next: string | null;
}

export interface AutoLyricLines {
  /** The lines to draw into the artwork, or null for the track's own artwork. */
  readonly lines: AutoLyricsFrame | null;
  /** The position at which `lines` change next while playing on, or null if they won't. */
  readonly nextChangeMs: number | null;
}

const COVER: AutoLyricLines = { lines: null, nextChangeMs: null };

/** A line as drawn: lines sung together share the one line. Empty for a pause in the singing. */
const textOf = (line: LyricLine | undefined): string => line?.text.split("\n").join(" / ") ?? "";

/** The nearest sung (non-empty) line from `index` on, stepping by `step`; null when there is none. */
const nearestSung = (lines: readonly LyricLine[], index: number, step: 1 | -1): string | null => {
  for (let at = index; at >= 0 && at < lines.length; at += step) {
    const text = textOf(lines[at]);
    if (text !== "") return text;
  }
  return null;
};

/**
 * What the artwork shows at `positionMs`. Lyrics only show with the toggle on
 * while Auto is connected: the phone's notification and lock screen share the
 * artwork, so they get the cover back once Auto disconnects. Only synced
 * lyrics show; before the first line and in a pause between lines (an empty
 * line) the cover does. The neighbours skip pauses, so the line after a pause
 * is already there below.
 */
export const autoLyricLines = ({
  on,
  carConnected,
  lyrics,
  positionMs,
}: AutoLyricLinesInput): AutoLyricLines => {
  if (!on || !carConnected || lyrics?.kind !== "synced") return COVER;
  const { lines } = lyrics;
  const index = currentLyricIndex(lines, positionMs);
  const nextChangeMs = lines[index + 1]?.timeMs ?? null;
  const current = textOf(lines[index]);
  if (current === "") return { lines: null, nextChangeMs };
  return {
    lines: {
      previous: nearestSung(lines, index - 1, -1),
      current,
      next: nearestSung(lines, index + 1, 1),
    },
    nextChangeMs,
  };
};
