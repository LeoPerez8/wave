import { useLocalisation } from "@/localisation/localisation";
import { appLyricsTranslationTarget, lyricsTranslationLanguageName, type Lyrics } from "@wave/core";
import { Storage } from "expo-sqlite/kv-store";
import { useEffect, useMemo, useState } from "react";

import { translateLyrics, type TranslationService } from "./lyricsTranslationSource";

/** A request that takes longer than this has failed. */
const REQUEST_TIMEOUT_MS = 15_000;

/** The phone's key-value store (this phone only, never synced) and Google Translate's endpoint. */
const phoneService: TranslationService = {
  read: (key) => Storage.getItemAsync(key),
  keep: (key, value) => Storage.setItemAsync(key, value),
  drop: async (key) => {
    await Storage.removeItemAsync(key);
  },
  post: async (url, body) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body,
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} from Google Translate`);
      return (await response.json()) as unknown;
    } finally {
      clearTimeout(timeout);
    }
  },
};

/** What shows under the lyrics while translation is on. */
export type TranslationShown =
  /** Asking Google: a skeleton line under each line with words. */
  | { readonly kind: "loading" }
  /** One translation per lyric line, in order; null where none shows. */
  | { readonly kind: "translated"; readonly lines: readonly (string | null)[] }
  /** The lyrics are already in the app's language, named in that language. */
  | { readonly kind: "sameLanguage"; readonly language: string }
  /** Offline, or Google failed: a quiet line and Try Again. */
  | { readonly kind: "failed" };

const LOADING: TranslationShown = { kind: "loading" };

/** The text of each of [lyrics]' lines, in order; null for none. */
const linesOf = (lyrics: Lyrics | null): readonly string[] | null => {
  if (lyrics === null) return null;
  switch (lyrics.kind) {
    case "synced":
      return lyrics.lines.map((line) => line.text);
    case "unsynced":
      return lyrics.lines;
    case "none":
      return null;
  }
};

/**
 * The translation of [song]'s [lyrics] into the app's language while [on]
 * (docs/spec.md, "Lyrics translation"), and Try Again. Null while off, for a
 * song without lyrics, or lyrics without a word; nothing is read or sent then.
 * [song] names the song for its saved translation (`lyricsTranslationKey`).
 */
export const useLyricsTranslation = (
  song: string | null,
  lyrics: Lyrics | null,
  on: boolean,
): { readonly shown: TranslationShown | null; readonly retry: () => void } => {
  const { language, strings } = useLocalisation();
  const lines = useMemo(() => linesOf(lyrics), [lyrics]);
  const [attempt, setAttempt] = useState(0);
  // What's being translated, as text: lyrics read again unchanged don't ask again.
  const ask = useMemo(
    () =>
      on && song !== null && lines !== null
        ? JSON.stringify({ song, lines, target: appLyricsTranslationTarget(language) })
        : null,
    [on, song, lines, language],
  );
  // The answer for one ask and attempt; another ask shows the skeleton until its own answer.
  const [answer, setAnswer] = useState<{
    readonly ask: string;
    readonly attempt: number;
    readonly shown: TranslationShown | null;
  } | null>(null);

  useEffect(() => {
    if (ask === null) return undefined;
    let current = true;
    void translateLyrics(
      JSON.parse(ask) as { song: string; lines: string[]; target: string },
      phoneService,
    ).then((translation) => {
      if (!current) return;
      const shown: TranslationShown | null =
        translation === null
          ? null
          : translation === "failed"
            ? { kind: "failed" }
            : translation.kind === "sameLanguage"
              ? {
                  kind: "sameLanguage",
                  language: lyricsTranslationLanguageName(translation.language, strings),
                }
              : { kind: "translated", lines: translation.lines };
      setAnswer({ ask, attempt, shown });
    });
    return () => {
      current = false;
    };
  }, [ask, attempt, strings]);

  const retry = useMemo(() => () => setAttempt((at) => at + 1), []);
  if (ask === null) return { shown: null, retry };
  if (answer === null || answer.ask !== ask || answer.attempt !== attempt)
    return { shown: LOADING, retry };
  return { shown: answer.shown, retry };
};
