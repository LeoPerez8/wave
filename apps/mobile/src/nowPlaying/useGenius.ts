import {
  GENIUS_LOADING_NOTE_DELAY_MS,
  geniusAbout,
  geniusLoadingNote,
  geniusReferents,
  geniusTranslationTarget,
  songLookup,
  type GeniusReferent,
  type SavedGenius,
} from "@wave/core";
import { Storage } from "expo-sqlite/kv-store";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { useLocalisation } from "@/localisation/localisation";
import { waveAccountAvailable } from "@/settings/waveAccount";
import {
  geniusInsightsEnabled,
  subscribeGeniusInsights,
  useGeniusInsightsEnabled,
} from "@/settings/genius";

import { loadGenius, translateGenius, type GeniusAsk, type GeniusService } from "./geniusSource";
import { keepGenius } from "./geniusStorage";
import { isPlayheadLive, playheadVisibility } from "./playhead";
import { askWaveService } from "@/sync/askWaveService";
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
  readonly state: "settled";
  readonly about: GeniusAboutCard | null;
  readonly referents: readonly GeniusReferent[] | null;
}

/** While the saved answer is read or Genius is asked, before a result is settled. */
export interface GeniusLoading {
  readonly state: "loading";
  readonly showNote: boolean;
}

/** The Lyrics view's Genius state, shaped to distinguish later miss and failure outcomes. */
export type GeniusState = GeniusLoading | GeniusShown;

/**
 * [request]'s answer, or a failure once it takes longer than
 * `REQUEST_TIMEOUT_MS` or [controller] aborts: a request that can't be
 * stopped (the native module's) then has its answer dropped. [request] gets
 * a signal that aborts with it.
 */
const withTimeout = <T>(
  controller: AbortController,
  request: (signal: AbortSignal) => Promise<T>,
): Promise<T> =>
  new Promise((resolve, reject) => {
    const own = new AbortController();
    const stop = (reason: Error): void => {
      own.abort();
      reject(reason);
    };
    const { signal } = controller;
    if (signal.aborted) {
      stop(new Error("The request was no longer wanted"));
      return;
    }
    const stopped = (): void => stop(new Error("The request was no longer wanted"));
    const timeout = setTimeout(() => stop(new Error("No answer in time")), REQUEST_TIMEOUT_MS);
    signal.addEventListener("abort", stopped, { once: true });
    request(own.signal)
      .then(resolve, reject)
      .finally(() => {
        clearTimeout(timeout);
        signal.removeEventListener("abort", stopped);
      });
  });

/** The JSON [url] answers with, from [source] (named in the error of an answer that isn't OK). */
const askJson = (
  controller: AbortController,
  source: string,
  url: string,
  init: RequestInit,
): Promise<unknown> =>
  withTimeout(controller, async (signal) => {
    const response = await fetch(url, { ...init, signal });
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
): GeniusState | null => {
  const { language } = useLocalisation();
  const target = geniusTranslationTarget(language);
  const on = useGeniusInsightsEnabled();
  const visible = useSyncExternalStore(playheadVisibility.subscribe, playheadVisibility.get);
  const signedIn = useWaveSignedIn();
  // Until the session is known nothing is read, so a signed-in phone never flashes the invitation.
  const asking = on && hasLyrics && signedIn !== null && waveAccountAvailable;
  // Kept while the song, its title and artist stay: a re-render with the same song doesn't ask again.
  const ask = useMemo((): GeniusAsk | null => {
    if (!asking || song === null) return null;
    const lookup = songLookup({ title, artist, album: "", durationMs: 0 });
    return lookup === null
      ? null
      : { key: song, song: lookup, signedIn: signedIn === true, target };
  }, [asking, song, title, artist, target, signedIn]);
  const [answer, setAnswer] = useState<{ ask: GeniusAsk; saved: SavedGenius | null } | null>(null);
  const settled = useRef<{ ask: GeniusAsk; saved: SavedGenius | null } | null>(null);
  const [loading, setLoading] = useState<{
    readonly ask: GeniusAsk;
    readonly showNote: boolean;
  } | null>(null);

  // Asks only while Now Playing shows on screen; an answer already in stays while it's hidden.
  useEffect(() => {
    if (ask === null || !visible) return undefined;
    const controller = new AbortController();
    let current = true;
    let noteTimer: ReturnType<typeof setTimeout> | undefined;
    const known = settled.current;
    if (known?.ask !== ask || known.saved === null) {
      setLoading({ ask, showNote: false });
      noteTimer = ask.signedIn
        ? setTimeout(() => {
            if (current) {
              setLoading((was) =>
                was?.ask === ask
                  ? { ask, showNote: geniusLoadingNote("loading", GENIUS_LOADING_NOTE_DELAY_MS) }
                  : was,
              );
            }
          }, GENIUS_LOADING_NOTE_DELAY_MS)
        : undefined;
    }
    const stop = subscribeGeniusInsights(() => {
      if (!geniusInsightsEnabled()) controller.abort();
    });
    const service: GeniusService = {
      read: (key) => Storage.getItemAsync(key),
      keep: keepGenius,
      enabled: () =>
        current && !controller.signal.aborted && geniusInsightsEnabled() && isPlayheadLive(),
      get: (path) => withTimeout(controller, () => askWaveService(path)),
      post: (url, body) =>
        askJson(controller, "Google Translate", url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
          body,
        }),
    };
    void loadGenius(ask, service).then(async (saved) => {
      // A failure while an answer for this song is already in (shown before Now Playing hid) keeps it.
      if (current) {
        const next =
          saved === null && settled.current?.ask === ask ? settled.current : { ask, saved };
        if (saved !== null || !ask.signedIn) settled.current = next;
        setAnswer((was) => (saved === null && was?.ask === ask ? was : next));
        setLoading(null);
      }
      if (saved === null) return;
      // The original shows meanwhile; a failure leaves it.
      const translated = await translateGenius(ask, saved, service);
      if (current && translated !== saved) setAnswer({ ask, saved: translated });
    });
    return () => {
      current = false;
      if (noteTimer !== undefined) clearTimeout(noteTimer);
      setLoading((was) => (was?.ask === ask ? null : was));
      stop();
      controller.abort();
    };
  }, [ask, visible]);

  const answered = ask !== null && answer?.ask === ask;
  const saved = answered ? answer.saved : null;
  const waiting = ask !== null && loading?.ask === ask;
  // Signed out with nothing saved: the invitation, once the store has been read.
  const invite = answered && saved === null && !ask.signedIn;
  return useMemo(() => {
    if (waiting) return { state: "loading", showNote: loading.showNote };
    if (invite) return { state: "settled", about: "signIn", referents: null };
    if (saved === null) return null;
    const { description: original } = saved;
    const shown = geniusAbout(saved, target);
    return {
      state: "settled",
      referents: geniusReferents(saved, target),
      about: original === null || shown === null ? null : { original, shown },
    };
  }, [invite, loading, saved, target, waiting]);
};
