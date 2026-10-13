import type { Lyrics } from "@wave/core";
import { useEffect, useState } from "react";

import { cachedTrackLyrics, readTrackLyrics } from "@/playback/trackLyrics";

/**
 * The lyrics to show for the file at `path`: its embedded lyrics or a sidecar
 * `.lrc`, picked by Core. `null` while they are first read (or with no track).
 */
export const useLyrics = (path: string | null): Lyrics | null => {
  const [read, setRead] = useState<{ path: string; lyrics: Lyrics } | null>(null);

  useEffect(() => {
    if (path === null) return undefined;
    let current = true;
    readTrackLyrics(path).then((lyrics) => {
      if (current) setRead({ path, lyrics });
    });
    return () => {
      current = false;
    };
  }, [path]);

  if (path === null) return null;
  return read?.path === path ? read.lyrics : cachedTrackLyrics(path);
};
