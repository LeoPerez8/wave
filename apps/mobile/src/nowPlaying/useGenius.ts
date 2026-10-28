import { songLookup, type SavedGenius } from "@wave/core";
import { Storage } from "expo-sqlite/kv-store";
import { useEffect, useState, useSyncExternalStore } from "react";

import {
  geniusInsightsEnabled,
  subscribeGeniusInsights,
  useGeniusInsightsEnabled,
} from "@/settings/genius";

import { loadGenius, type GeniusAsk } from "./geniusSource";
import { keepGenius } from "./geniusStorage";
import { isPlayheadLive, playheadVisibility } from "./playhead";

/**
 * Genius's client access token, which CI inlines into the bundle from the
 * `GENIUS_ACCESS_TOKEN` secret (docs/spec.md, Build and CI). A build without
 * it (local, with no `.env`) never asks Genius.
 */
const GENIUS_TOKEN = process.env.EXPO_PUBLIC_GENIUS_ACCESS_TOKEN?.trim() ?? "";

/** A request that takes longer than this has failed. */
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * What Genius says about the song the Lyrics view shows (docs/spec.md,
 * "Genius About"): its saved answer, or Genius's, asked only while the view
 * shows lyrics ([hasLyrics]) on screen with "Genius insights" on and a token
 * in the build. [song] keys its saved answer: a Library track by its id, a
 * non-D song by its track id. Null until the answer comes, and for a miss
 * or a failure. The lyrics never wait for it.
 */
export const useGenius = (
  song: string | null,
  title: string,
  artist: string,
  hasLyrics: boolean,
): SavedGenius | null => {
  const on = useGeniusInsightsEnabled();
  const visible = useSyncExternalStore(playheadVisibility.subscribe, playheadVisibility.get);
  const lookup = songLookup({ title, artist, album: "", durationMs: 0 });
  // What's asked, as text: a re-render with the same song doesn't ask again.
  const ask =
    on && hasLyrics && GENIUS_TOKEN !== "" && song !== null && lookup !== null
      ? JSON.stringify({ key: song, song: lookup, token: GENIUS_TOKEN } satisfies GeniusAsk)
      : null;
  const [answer, setAnswer] = useState<{ ask: string; saved: SavedGenius | null } | null>(null);

  // Asks only while Now Playing shows on screen; an answer already in stays while it's hidden.
  useEffect(() => {
    if (ask === null || !visible) return undefined;
    const controller = new AbortController();
    let current = true;
    const stop = subscribeGeniusInsights(() => {
      if (!geniusInsightsEnabled()) controller.abort();
    });
    void loadGenius(JSON.parse(ask) as GeniusAsk, {
      read: (key) => Storage.getItemAsync(key),
      keep: keepGenius,
      enabled: () =>
        current && !controller.signal.aborted && geniusInsightsEnabled() && isPlayheadLive(),
      get: async (url, token) => {
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
          const response = await fetch(url, {
            headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
            signal: controller.signal,
          });
          if (!response.ok) throw new Error(`HTTP ${response.status} from Genius`);
          return (await response.json()) as unknown;
        } finally {
          clearTimeout(timeout);
        }
      },
    }).then((saved) => {
      // A failure while an answer for this song is already in (shown before Now Playing hid) keeps it.
      if (current) setAnswer((was) => (saved === null && was?.ask === ask ? was : { ask, saved }));
    });
    return () => {
      current = false;
      stop();
      controller.abort();
    };
  }, [ask, visible]);

  return ask !== null && answer?.ask === ask ? answer.saved : null;
};
