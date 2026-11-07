import {
  geniusAbout,
  geniusReferents,
  geniusTranslationTarget,
  songLookup,
  type GeniusReferent,
  type SavedGenius,
} from "@wave/core";
import { Storage } from "expo-sqlite/kv-store";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { useLocalisation } from "@/localisation/localisation";
import { WaveAccount } from "@/native/waveAccount";
import { WAVE_ACCOUNT_CONFIG } from "@/settings/waveAccount";
import {
  geniusInsightsEnabled,
  subscribeGeniusInsights,
  useGeniusInsightsEnabled,
} from "@/settings/genius";

import { loadGenius, translateGenius, type GeniusAsk, type GeniusService } from "./geniusSource";
import { keepGenius } from "./geniusStorage";
import { isPlayheadLive, playheadVisibility } from "./playhead";
import { useWaveSignedIn } from "@/sync/waveSignedIn";

/** A request that takes longer than this has failed. */
const REQUEST_TIMEOUT_MS = 15_000;

/** The About card's text: [shown] is [original] or its translation, which replaces it in place. */
export interface GeniusAboutText {
  readonly original: string;
  readonly shown: string;
}

/**
 * What the About card shows: Genius's text, or `"signIn"`, the invitation to
 * sign in to a Wave account, for a song with nothing saved while signed out.
 */
export type GeniusAboutCard = GeniusAboutText | "signIn";

/** What keys the About card: its original text, so a translation arriving keeps it as it is. */
export const geniusAboutKey = (about: GeniusAboutCard | null): string | undefined =>
  about === "signIn" ? about : about?.original;

/** What the Lyrics view shows of Genius's answer. */
export interface GeniusShown {
  readonly about: GeniusAboutCard | null;
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
 * The JSON the sync service's Genius route [path] answers with, sent by the
 * native module with the session JS never sees. Rejects for an answer that
 * isn't OK (an older service that has no such route, a limit, Genius
 * failing), a signed-out phone and a timeout; the request itself can't be
 * stopped, so the caller checks it's still wanted before using the answer.
 */
const askGenius = (path: string): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Genius didn't answer in time")),
      REQUEST_TIMEOUT_MS,
    );
    WaveAccount.request("GET", path, null).then(
      (response) => {
        clearTimeout(timeout);
        if (response.status !== 200) {
          reject(new Error(`HTTP ${response.status} from Wave's Genius route`));
          return;
        }
        try {
          resolve(JSON.parse(response.body) as unknown);
        } catch (cause) {
          reject(cause);
        }
      },
      (cause: unknown) => {
        clearTimeout(timeout);
        reject(cause);
      },
    );
  });

/** The JSON [url] answers with, from [source] (named in the error of an answer that isn't OK). */
const askJson = (
  controller: AbortController,
  source: string,
  url: string,
  init: RequestInit,
): Promise<unknown> =>
  withTimeout(controller, async () => {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${source}`);
    return (await response.json()) as unknown;
  });

/**
 * What Genius says about the song the Lyrics view shows (docs/spec.md,
 * "Genius About"): its saved answer, or Genius's, asked through the Wave
 * account only while the view shows lyrics ([hasLyrics]) on screen with
 * "Genius insights" on and an account signed in, and in the app's language
 * once Google's translation comes. Signed out, a song with nothing saved
 * shows the invitation to sign in instead (a build with no sync service
 * shows nothing). [song] keys its saved answer: a Library track by its id, a
 * non-D song by its track id. Null until the answer comes, and for a miss or
 * a failure. The lyrics never wait for it.
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
  const signedIn = useWaveSignedIn();
  // Until the session is known nothing is read, so a signed-in phone never flashes the invitation.
  const asking = on && hasLyrics && signedIn !== null && WAVE_ACCOUNT_CONFIG !== null;
  // Kept while the song, its title and artist stay: a re-render with the same song doesn't ask again.
  const ask = useMemo((): GeniusAsk | null => {
    if (!asking || song === null) return null;
    const lookup = songLookup({ title, artist, album: "", durationMs: 0 });
    return lookup === null
      ? null
      : { key: song, song: lookup, signedIn: signedIn === true, target };
  }, [asking, song, title, artist, target, signedIn]);
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
      get: askGenius,
      post: (url, body) =>
        askJson(controller, "Google Translate", url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
          body,
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

  const answered = ask !== null && answer?.ask === ask;
  const saved = answered ? answer.saved : null;
  // Signed out with nothing saved: the invitation, once the store has been read.
  const invite = answered && saved === null && !ask.signedIn;
  return useMemo(() => {
    if (invite) return { about: "signIn", referents: null };
    if (saved === null) return null;
    const { description: original } = saved;
    const shown = geniusAbout(saved, target);
    return {
      referents: geniusReferents(saved, target),
      about: original === null || shown === null ? null : { original, shown },
    };
  }, [invite, saved, target]);
};
