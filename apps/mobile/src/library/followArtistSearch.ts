import {
  artistFindText,
  createFindableList,
  deezerArtistSearchUrl,
  deezerFollowArtists,
  mergeFollowArtistSearch,
  type DeezerFollowArtist,
} from "@wave/core";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { useScreenSight } from "@/lib/screenSight";
import { followedArtistsEnabled } from "@/settings/followedArtists";
import { useArtists } from "./hooks";

/** Local matches show immediately; only the artist query goes to Deezer after a pause. */
export const useFollowArtistSearch = (query: string, enabled: boolean) => {
  const artists = useArtists();
  const finder = useMemo(
    () => createFindableList(artists, (artist) => artistFindText(artist.name), true),
    [artists],
  );
  const text = query.trim();
  const sight = useScreenSight();
  const visible = useSyncExternalStore(sight.subscribe, sight.visible);
  const [answer, setAnswer] = useState<{
    query: string;
    artists: readonly DeezerFollowArtist[];
    failed: boolean;
  } | null>(null);

  useEffect(() => {
    if (text === "" || !enabled || !visible) return;
    const controller = new AbortController();
    let current = true;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const debounce = setTimeout(() => {
      if (!followedArtistsEnabled()) return;
      timeout = setTimeout(() => controller.abort(), 10_000);
      void (async () => {
        try {
          const response = await fetch(deezerArtistSearchUrl(text), { signal: controller.signal });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const found = deezerFollowArtists(await response.json());
          if (found === null) throw new Error("Not an artist search result");
          if (current) setAnswer({ query: text, artists: found, failed: false });
        } catch {
          if (current) setAnswer({ query: text, artists: [], failed: true });
        } finally {
          clearTimeout(timeout);
        }
      })();
    }, 350);
    return () => {
      current = false;
      clearTimeout(debounce);
      clearTimeout(timeout);
      controller.abort();
    };
  }, [text, enabled, visible]);

  const online = enabled && answer?.query === text ? answer : null;
  return {
    results:
      text === ""
        ? []
        : mergeFollowArtistSearch(artists, finder.show(text).songs, online?.artists ?? []),
    failed: online?.failed ?? false,
    pending: enabled && online === null,
  };
};
