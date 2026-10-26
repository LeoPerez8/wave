/**
 * The lyrics Wave shows on Android Auto's player screen with the Lyrics
 * toggle in its overflow menu on: the synced line being sung in place of the
 * title, and the next sung line in place of the artist. The cover stays.
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

/** What the now-playing title and artist show in place of the track's own. */
export interface AutoLyricsText {
  /** The line being sung, as the title. */
  readonly title: string;
  /** The next sung line, as the artist; null keeps the track's own artist (after the last line). */
  readonly artist: string | null;
}

export interface AutoLyricLines {
  /** The lyrics to show as the title and artist, or null for the track's own. */
  readonly text: AutoLyricsText | null;
  /** The position at which `text` changes next while playing on, or null if it won't. */
  readonly nextChangeMs: number | null;
}

const REAL: AutoLyricLines = { text: null, nextChangeMs: null };

/** A line as shown: lines sung together share the one line. Empty for a pause in the singing. */
const textOf = (line: LyricLine | undefined): string => line?.text.split("\n").join(" / ") ?? "";

/** The first sung (non-empty) line after `index`; null when there is none. */
const nextSung = (lines: readonly LyricLine[], index: number): string | null => {
  for (let at = index + 1; at < lines.length; at += 1) {
    const text = textOf(lines[at]);
    if (text !== "") return text;
  }
  return null;
};

/**
 * What the title and artist show at `positionMs`. Lyrics only show with the
 * toggle on while Auto is connected: the phone's notification and lock screen
 * share the title and artist, so they get the real ones back once Auto
 * disconnects. Only synced lyrics show; before the first line and in a pause
 * between lines (an empty line) the real title and artist do. The artist
 * skips pauses, so the line after a pause is already there; on the last line
 * it is the real artist.
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
  const nextChangeMs = lines[index + 1]?.timeMs ?? null;
  const title = textOf(lines[index]);
  if (title === "") return { text: null, nextChangeMs };
  return { text: { title, artist: nextSung(lines, index) }, nextChangeMs };
};
