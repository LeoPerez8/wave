import {
  geniusAbout,
  geniusTranslationTarget,
  songLookup,
  type GeniusReferent,
  type SavedGenius,
} from "@wave/core";
import { Storage } from "expo-sqlite/kv-store";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { useLocalisation } from "@/localisation/localisation";
import {
  geniusInsightsEnabled,
  subscribeGeniusInsights,
  useGeniusInsightsEnabled,
} from "@/settings/genius";

import { loadGenius, translateGenius, type GeniusAsk, type GeniusService } from "./geniusSource";
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

/** The About card's text: [shown] is [original] or its translation, which replaces it in place. */
export interface GeniusAboutText {
  readonly original: string;
  readonly shown: string;
}

/** What the Lyrics view shows of Genius's answer. */
export interface GeniusShown {
  readonly about: GeniusAboutText | null;
  readonly referents: readonly GeniusReferent[] | null;
}

/** A request that takes longer than this has failed; aborted through [controller]. */
const withTimeout = async <T>(
  controller: AbortController,
  request: () => Promise<T>,
): Promise<T> => {
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await request();
  } finally {
    clearTimeout(timeout);
  }
};

/**
 * What Genius says about the song the Lyrics view shows (docs/spec.md,
 * "Genius About"): its saved answer, or Genius's, asked only while the view
 * shows lyrics ([hasLyrics]) on screen with "Genius insights" on and a token
 * in the build, and in the app's language once Google's translation comes.
 * [song] keys its saved answer: a Library track by its id, a non-D song by
 * its track id. Null until the answer comes, and for a miss or a failure.
 * The lyrics never wait for it.
 */
export const useGenius = (
  song: string | null,
  title: string,
  artist: string,
  hasLyrics: boolean,
): GeniusShown | null => {
  const { language } = useLocalisation();
  const target = geniusTranslationTarget(language);
  const on = useGeniusInsightsEnabled();
  const visible = useSyncExternalStore(playheadVisibility.subscribe, playheadVisibility.get);
  const asking = on && hasLyrics && GENIUS_TOKEN !== "";
  // Kept while the song, its title and artist stay: a re-render with the same song doesn't ask again.
  const ask = useMemo((): GeniusAsk | null => {
    if (!asking || song === null) return null;
    const lookup = songLookup({ title, artist, album: "", durationMs: 0 });
    return lookup === null ? null : { key: song, song: lookup, token: GENIUS_TOKEN, target };
  }, [asking, song, title, artist, target]);
  const [answer, setAnswer] = useState<{ ask: GeniusAsk; saved: SavedGenius | null } | null>(null);

  // Asks only while Now Playing shows on screen; an answer already in stays while it's hidden.
  useEffect(() => {
    if (ask === null || !visible) return undefined;
    const controller = new AbortController();
    let current = true;
    const stop = subscribeGeniusInsights(() => {
      if (!geniusInsightsEnabled()) controller.abort();
    });
    const service: GeniusService = {
      read: (key) => Storage.getItemAsync(key),
      keep: keepGenius,
      enabled: () =>
        current && !controller.signal.aborted && geniusInsightsEnabled() && isPlayheadLive(),
      get: (url, token) =>
        withTimeout(controller, async () => {
          const response = await fetch(url, {
            headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
            signal: controller.signal,
          });
          if (!response.ok) throw new Error(`HTTP ${response.status} from Genius`);
          return (await response.json()) as unknown;
        }),
      post: (url, body) =>
        withTimeout(controller, async () => {
          const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
            body,
            signal: controller.signal,
          });
          if (!response.ok) throw new Error(`HTTP ${response.status} from Google Translate`);
          return (await response.json()) as unknown;
        }),
    };
    void loadGenius(ask, service).then(async (saved) => {
      // A failure while an answer for this song is already in (shown before Now Playing hid) keeps it.
      if (current) setAnswer((was) => (saved === null && was?.ask === ask ? was : { ask, saved }));
      if (saved === null) return;
      // The original shows meanwhile; a failure leaves it.
      const translated = await translateGenius(ask, saved, service);
      if (current && translated !== saved) setAnswer({ ask, saved: translated });
    });
    return () => {
      current = false;
      stop();
      controller.abort();
    };
  }, [ask, visible]);

  const saved = ask !== null && answer?.ask === ask ? answer.saved : null;
  return useMemo(() => {
    if (saved === null) return null;
    const { description: original, referents } = saved;
    const shown = geniusAbout(saved, target);
    return {
      referents,
      about: original === null || shown === null ? null : { original, shown },
    };
  }, [saved, target]);
};
