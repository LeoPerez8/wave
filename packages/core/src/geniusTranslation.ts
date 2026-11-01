/**
 * Genius's text in the app's language (docs/spec.md, "Genius About" and
 * "Genius annotations"): when Google Translate is asked, the requests, their
 * replies read into the saved answer, and what shows. Each text is saved
 * under what it translated, so a text that changed finds no translation and
 * is asked afresh.
 */

import type { SavedGenius } from "./genius.ts";
import type { GeniusReferent } from "./geniusAnnotations.ts";
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

/**
 * The most a request's body holds. Past about 200 KB Google has answered 200
 * with some texts empty or half translated, at one time and not at another
 * (measured Oct 2026), so a request stays far below it.
 */
const REQUEST_MAX_BYTES = 60_000;

/** Every text of [saved] that is translated, once each and each sent as its own `q`. */
const geniusTexts = ({ description, referents }: SavedGenius): readonly string[] => [
  ...new Set([
    ...(description === null ? [] : [description]),
    ...(referents ?? []).flatMap(({ annotations }) => annotations.map(({ text }) => text)),
  ]),
];

const translationKey = (text: string, target: string): string => `${target}:${fingerprint([text])}`;

const translationOf = (saved: SavedGenius, text: string, target: string): string | undefined =>
  saved.translations[translationKey(text, target)];

/** The texts of [saved] with no translation into [target] yet. */
const missingTexts = (saved: SavedGenius, target: string): readonly string[] =>
  geniusTexts(saved).filter((text) => translationOf(saved, text, target) === undefined);

/** [texts] in order, cut wherever the next would take a request past `REQUEST_MAX_BYTES`. */
const inRequests = (texts: readonly string[]): readonly (readonly string[])[] => {
  const requests: string[][] = [];
  let room = 0;
  for (const text of texts) {
    const bytes = encodeURIComponent(text).length + "&q=".length;
    if (bytes > room) {
      requests.push([]);
      room = REQUEST_MAX_BYTES;
    }
    requests.at(-1)!.push(text);
    room -= bytes;
  }
  return requests;
};

/** The requests for what [saved] still lacks in [target], in order; none when nothing is missing. */
export const geniusTranslationRequests = (
  saved: SavedGenius,
  target: string,
): readonly LyricsTranslationRequest[] =>
  inRequests(missingTexts(saved, target)).flatMap((texts) => {
    const request = lyricsTranslationRequest(texts, target);
    return request === null ? [] : [request];
  });

/**
 * [saved] with [replies], Google's answers to `geniusTranslationRequests` in
 * their order, read in; translations of text it no longer has are dropped. A
 * text already in [target] is kept as it came, so it isn't asked again. Null
 * unless every reply can be read: nothing is saved, so a song is never left
 * half translated, and the next opening asks again.
 */
export const withGeniusTranslation = (
  saved: SavedGenius,
  target: string,
  replies: readonly unknown[],
): SavedGenius | null => {
  const asked = inRequests(missingTexts(saved, target));
  if (asked.length === 0 || replies.length !== asked.length) return null;
  const translations: Record<string, string> = {};
  for (const text of geniusTexts(saved)) {
    const kept = translationOf(saved, text, target);
    if (kept !== undefined) translations[translationKey(text, target)] = kept;
  }
  for (const [at, texts] of asked.entries()) {
    const translated = parseTranslatedTexts(texts, target, replies[at]);
    if (translated === null) return null;
    texts.forEach((text, line) => {
      translations[translationKey(text, target)] = translated[line]!;
    });
  }
  return { ...saved, translations };
};

/** The description to show: its translation into [target] once there is one, else as it came. */
export const geniusAbout = (saved: SavedGenius, target: string | null): string | null => {
  const { description } = saved;
  if (description === null || target === null) return description;
  return translationOf(saved, description, target) ?? description;
};

/**
 * The annotations to show: each with its translation into [target] once every
 * one has its own, else all as they came. Fragments stay Genius's, so placing
 * them on the lines doesn't change.
 */
export const geniusReferents = (
  saved: SavedGenius,
  target: string | null,
): readonly GeniusReferent[] | null => {
  const { referents } = saved;
  if (referents === null || target === null) return referents;
  const translated = (text: string) => translationOf(saved, text, target);
  const whole = referents.every(({ annotations }) =>
    annotations.every(({ text }) => translated(text) !== undefined),
  );
  if (!whole) return referents;
  return referents.map((referent) => ({
    ...referent,
    annotations: referent.annotations.map((annotation) => ({
      ...annotation,
      text: translated(annotation.text)!,
    })),
  }));
};
