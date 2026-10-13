/**
 * The line under the title on Android Auto's player screen, with the Lyrics
 * toggle in its overflow menu: the synced lyric line being sung, or the
 * artist.
 */
import { currentLyricIndex, type Lyrics } from "./lyrics.ts";

export interface AutoLyricLineInput {
  /** The Lyrics toggle on Auto's player screen. */
  readonly on: boolean;
  /** Whether Android Auto is connected. */
  readonly carConnected: boolean;
  /** The current track's lyrics (Core's `pickLyrics`); null while they are read. */
  readonly lyrics: Lyrics | null;
  /** Where the current track is. */
  readonly positionMs: number;
}

export interface AutoLyricLine {
  /** The lyric line to show under the title, or null to show the artist. */
  readonly line: string | null;
  /** The position at which `line` changes next while playing on, or null if it won't. */
  readonly nextChangeMs: number | null;
}

const ARTIST: AutoLyricLine = { line: null, nextChangeMs: null };

/**
 * What the line under the title shows at `positionMs`. Lyrics only show with
 * the toggle on while Auto is connected: the phone's notification and lock
 * screen share that line, so they get the artist back once Auto disconnects.
 * Only synced lyrics show; before the first line and in a pause between lines
 * (an empty line) the artist does.
 */
export const autoLyricLine = ({
  on,
  carConnected,
  lyrics,
  positionMs,
}: AutoLyricLineInput): AutoLyricLine => {
  if (!on || !carConnected || lyrics?.kind !== "synced") return ARTIST;
  const { lines } = lyrics;
  const index = currentLyricIndex(lines, positionMs);
  // Lines sung together share the one line; an empty line is a pause in the singing.
  const line = lines[index]?.text.split("\n").join(" / ") || null;
  return { line, nextChangeMs: lines[index + 1]?.timeMs ?? null };
};
