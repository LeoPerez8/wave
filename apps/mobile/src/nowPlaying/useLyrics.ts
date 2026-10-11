import { pickLyrics, type Lyrics } from "@wave/core";
import { useEffect, useState } from "react";

import { WaveNative } from "@/native/waveNative";

/**
 * Lyrics last read, by file path, so going back to a recent track shows them
 * at once. They're read again each time anyway, so an `.lrc` dropped in
 * beside the file shows up the next time the Lyrics view opens.
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
 * The lyrics to show for the file at `path`: its embedded lyrics or a sidecar
 * `.lrc`, picked by Core. `null` while they are first read (or with no track).
 */
export const useLyrics = (path: string | null): Lyrics | null => {
  const [read, setRead] = useState<{ path: string; lyrics: Lyrics } | null>(null);

  useEffect(() => {
    if (path === null) return undefined;
    let current = true;
    WaveNative.readLyrics(path)
      .then(pickLyrics)
      // A file that can't be read has no lyrics to show.
      .catch(() => NONE)
      .then((lyrics) => {
        remember(path, lyrics);
        if (current) setRead({ path, lyrics });
      });
    return () => {
      current = false;
    };
  }, [path]);

  if (path === null) return null;
  return read?.path === path ? read.lyrics : (cache.get(path) ?? null);
};
