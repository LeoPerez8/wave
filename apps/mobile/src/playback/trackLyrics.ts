import { pickLyrics, type Lyrics } from "@wave/core";

import { WaveNative } from "@/native/waveNative";

/**
 * Lyrics last read, by file path, so going back to a recent track shows them
 * at once. They're read again each time anyway, so an `.lrc` dropped in
 * beside the file shows up the next time they're asked for.
 */
const cache = new Map<string, Lyrics>();
const CACHE_SIZE = 16;

const remember = (path: string, lyrics: Lyrics): void => {
  cache.delete(path);
  cache.set(path, lyrics);
  if (cache.size > CACHE_SIZE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
};

const NONE: Lyrics = { kind: "none" };

/**
 * The lyrics to show for the file at `path`, for the Lyrics view and Auto's
 * artwork: its embedded lyrics or a sidecar `.lrc`, picked by Core. A file
 * that can't be read has none.
 */
export const readTrackLyrics = (path: string): Promise<Lyrics> =>
  WaveNative.readLyrics(path)
    .then(pickLyrics)
    .catch(() => NONE)
    .then((lyrics) => {
      remember(path, lyrics);
      return lyrics;
    });

/** The lyrics last read for `path`, if they still are in the cache. */
export const cachedTrackLyrics = (path: string): Lyrics | null => cache.get(path) ?? null;
