import type { Lyrics } from "@wave/core";
import { useEffect, useState, useSyncExternalStore } from "react";

import { lyricsEdits } from "@/library/lyricsEdits";
import { cachedTrackLyrics, readTrackLyrics } from "@/playback/trackLyrics";

/**
 * The lyrics to show for the file at `path`: its embedded lyrics or a sidecar
 * `.lrc`, picked by Core. `null` while they are first read (or with no track).
 */
export const useLyrics = (path: string | null): Lyrics | null => {
  const [read, setRead] = useState<{ path: string; lyrics: Lyrics } | null>(null);
  // Lyrics Wave wrote into this file (Find Lyrics and Genre) are read again at once.
  const edits = useSyncExternalStore(lyricsEdits.subscribe, () => {
    const edit = lyricsEdits.get();
    return edit.path === path ? edit.count : 0;
  });

  useEffect(() => {
    if (path === null) return undefined;
    let current = true;
    readTrackLyrics(path).then((lyrics) => {
      if (current) setRead({ path, lyrics });
    });
    return () => {
      current = false;
    };
  }, [path, edits]);

  if (path === null) return null;
  return read?.path === path ? read.lyrics : cachedTrackLyrics(path);
};
