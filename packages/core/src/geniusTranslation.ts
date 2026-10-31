/**
 * Genius's text in the app's language (docs/spec.md, "Genius About"): when
 * Google Translate is asked, the request, its reply read into the saved
 * answer, and what shows. Each text is saved under what it translated, so a
 * text that changed finds no translation and is asked afresh.
 */

import type { SavedGenius } from "./genius.ts";
import type { AppLanguage } from "./localisation.ts";
import {
  appLyricsTranslationTarget,
  fingerprint,
  lyricsTranslationRequest,
  parseTranslatedTexts,
  type LyricsTranslationRequest,
} from "./lyricsTranslation.ts";

/** Google's code for what Genius's text is translated into; null for an app in English, which shows it as it came. */
export const geniusTranslationTarget = (language: AppLanguage): string | null =>
  language === "en" ? null : appLyricsTranslationTarget(language);

/** Every text of [saved] that is translated, each sent as its own `q`. */
const geniusTexts = ({ description }: SavedGenius): readonly string[] =>
  description === null ? [] : [description];

const translationKey = (text: string, target: string): string => `${target}:${fingerprint([text])}`;

const translationOf = (saved: SavedGenius, text: string, target: string): string | undefined =>
  saved.translations[translationKey(text, target)];

/** The texts of [saved] with no translation into [target] yet. */
const missingTexts = (saved: SavedGenius, target: string): readonly string[] =>
  geniusTexts(saved).filter((text) => translationOf(saved, text, target) === undefined);

/** The request for what [saved] still lacks in [target]; null when nothing is missing, and nothing is sent. */
export const geniusTranslationRequest = (
  saved: SavedGenius,
  target: string,
): LyricsTranslationRequest | null => lyricsTranslationRequest(missingTexts(saved, target), target);

/**
 * [saved] with [reply], Google's answer to `geniusTranslationRequest`, read
 * in; translations of text it no longer has are dropped. A text already in
 * [target] is kept as it came, so it isn't asked again. Null when the reply
 * can't be read: nothing is saved, and the next opening asks again.
 */
export const withGeniusTranslation = (
  saved: SavedGenius,
  target: string,
  reply: unknown,
): SavedGenius | null => {
  const missing = missingTexts(saved, target);
  const translated = parseTranslatedTexts(missing, target, reply);
  if (translated === null) return null;
  const translations: Record<string, string> = {};
  for (const text of geniusTexts(saved)) {
    const kept = translationOf(saved, text, target);
    if (kept !== undefined) translations[translationKey(text, target)] = kept;
  }
  missing.forEach((text, at) => {
    translations[translationKey(text, target)] = translated[at]!;
  });
  return { ...saved, translations };
};

/** The description to show: its translation into [target] once there is one, else as it came. */
export const geniusAbout = (saved: SavedGenius, target: string | null): string | null => {
  const { description } = saved;
  if (description === null || target === null) return description;
  return translationOf(saved, description, target) ?? description;
};
