/**
 * Buffer (Settings › Playback): how much streamed audio the player keeps
 * loaded ahead of what's playing, carrying on past the current song into the
 * next ones in Up Next. Library files keep the player's own default.
 */

/** The Buffer choices, in minutes. 1 is the floor: less is worse than the player's default. */
export const STREAM_BUFFER_MINUTES = [1, 2, 5, 10, 15, 30] as const;

export type StreamBufferMinutes = (typeof STREAM_BUFFER_MINUTES)[number];

export const STREAM_BUFFER_DEFAULT: StreamBufferMinutes = 2;

const isOffered = (minutes: number): minutes is StreamBufferMinutes =>
  (STREAM_BUFFER_MINUTES as readonly number[]).includes(minutes);

/** The stored choice (null when nothing is stored); anything not offered is the default. */
export const readStreamBuffer = (stored: string | null): StreamBufferMinutes => {
  const minutes = stored === null ? Number.NaN : Number(stored);
  return isOffered(minutes) ? minutes : STREAM_BUFFER_DEFAULT;
};

/** What JS hands the playback service for the choice of [minutes], in ms. */
export const streamBufferMs = (minutes: StreamBufferMinutes): number => minutes * 60_000;

/**
 * How far ahead the player loads by default (ExoPlayer's 50 s): what library
 * files keep, and the least a streamed song gets.
 */
export const LIBRARY_BUFFER_MS = 50_000;

/**
 * How much audio, in ms, the player keeps loaded ahead of the playing position
 * while it loads a song: [chosenMs] (the Buffer setting, `streamBufferMs`) for
 * a [streamed] one, never under `LIBRARY_BUFFER_MS`, and `LIBRARY_BUFFER_MS`
 * for a library file. What's buffered spans song boundaries, so a long buffer
 * holds the next songs in Up Next too. The playback service mirrors it
 * (Kotlin `StreamBuffer.aheadMs`); its `StreamBufferTest` runs these cases.
 */
export const bufferAheadMs = (chosenMs: number, streamed: boolean): number =>
  streamed ? Math.max(chosenMs, LIBRARY_BUFFER_MS) : LIBRARY_BUFFER_MS;
