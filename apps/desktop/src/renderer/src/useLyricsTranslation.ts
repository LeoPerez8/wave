/**
 * Translate in the Lyrics view (docs/spec.md, "Lyrics translation"): one switch for the side
 * panel and Now Playing, kept by main on this computer, and what shows under the lines while
 * it's on. Main reads the lyrics and asks Google; with the switch off nothing is asked.
 */
import { lyricsTranslationLanguageName } from "@wave/core";
import { useEffect, useState, useSyncExternalStore } from "react";

import type { SongTranslation } from "../../shared/lyrics.ts";
import { language, text } from "./text.ts";

let on = false;
let asked = false;
const listeners = new Set<() => void>();
const show = (value: boolean) => {
  on = value;
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  if (!asked) {
    asked = true;
    void window.wave.lyrics.translateOn().then(show, () => {});
  }
  return () => listeners.delete(listener);
};

/** Whether Translate is on, and the button's press; off until main has answered. */
export function useTranslateOn(): readonly [boolean, (value: boolean) => void] {
  const value = useSyncExternalStore(subscribe, () => on);
  return [
    value,
    (next) => {
      show(next);
      void window.wave.lyrics.setTranslateOn(next).then(show, () => show(!next));
    },
  ];
}

/** What shows with the lyrics while Translate is on. */
export type TranslationShown =
  /** Asking: a still skeleton line under each line with words. */
  | { readonly kind: "loading" }
  /** One translation per lyric line, in order; null where none shows. */
  | { readonly kind: "translated"; readonly lines: readonly (string | null)[] }
  /** The lyrics are already in the app's language, named in that language. */
  | { readonly kind: "sameLanguage"; readonly language: string }
  /** Offline, or Google failed: a quiet line and Try Again. */
  | { readonly kind: "failed" };

export interface LyricsTranslationView {
  readonly shown: TranslationShown | null;
  readonly retry: () => void;
}

const LOADING: TranslationShown = { kind: "loading" };

const shownOf = (answer: SongTranslation, count: number): TranslationShown | null => {
  switch (answer.kind) {
    case "off":
      return null;
    case "failed":
      return { kind: "failed" };
    case "sameLanguage":
      return {
        kind: "sameLanguage",
        language: lyricsTranslationLanguageName(answer.language, text),
      };
    case "translated":
      // Lyrics that changed since main read them show untranslated rather than misplaced.
      return answer.lines.length === count ? answer : null;
  }
};

/**
 * The translation of the queue track [trackId]'s [lines] into the app's language while
 * Translate is [translateOn]; null shown while off or for a song without lines.
 */
export function useLyricsTranslation(
  trackId: string | null,
  lines: readonly { readonly text: string }[] | undefined,
  translateOn: boolean,
): LyricsTranslationView {
  const key =
    translateOn && trackId !== null && lines !== undefined && lines.length > 0
      ? JSON.stringify([trackId, language, lines.map((line) => line.text)])
      : null;
  const count = lines?.length ?? 0;
  const [attempt, setAttempt] = useState(0);
  const [answer, setAnswer] = useState<{
    readonly key: string;
    readonly attempt: number;
    readonly shown: TranslationShown | null;
  }>();
  useEffect(() => {
    if (key === null || trackId === null) return;
    let current = true;
    const done = (translation: SongTranslation) => {
      if (current) setAnswer({ key, attempt, shown: shownOf(translation, count) });
    };
    window.wave.lyrics.translation(trackId, language).then(done, () => done({ kind: "failed" }));
    return () => {
      current = false;
    };
  }, [key, attempt, trackId, count]);
  const retry = () => setAttempt((n) => n + 1);
  if (key === null) return { shown: null, retry };
  if (answer?.key !== key || answer.attempt !== attempt) return { shown: LOADING, retry };
  return { shown: answer.shown, retry };
}
