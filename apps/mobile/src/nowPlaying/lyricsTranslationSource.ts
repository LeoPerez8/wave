import {
  lyricsTranslationKey,
  lyricsTranslationRequest,
  parseLyricsTranslation,
  savedLyricsTranslation,
  storedLyricsTranslation,
  type LyricsTranslation,
} from "@wave/core";

/** What a translation needs from the phone: its key-value store, and a POST to Google. */
export interface TranslationService {
  readonly read: (key: string) => Promise<string | null>;
  readonly keep: (key: string, value: string) => Promise<void>;
  readonly drop: (key: string) => Promise<void>;
  /** POSTs the form [body] to [url] and gives its JSON; rejects when it can't (offline, an error status). */
  readonly post: (url: string, body: string) => Promise<unknown>;
}

/** Which lyrics to translate: [song]'s (its Core key), its [lines] in order, into [target]. */
export interface TranslationAsk {
  readonly song: string;
  readonly lines: readonly string[];
  readonly target: string;
}

/**
 * [ask]'s lyrics translated (docs/spec.md, "Lyrics translation"): the
 * translation saved on the phone for these very lyrics, with no request, or
 * Google's, saved for next time (a same-language answer too). A saved one
 * for lyrics that changed since is dropped. "failed" when Google can't be
 * reached or answers something unreadable, which saves nothing; null when
 * the lyrics have no words, and nothing is sent. Never rejects.
 */
export const translateLyrics = async (
  { song, lines, target }: TranslationAsk,
  service: TranslationService,
): Promise<LyricsTranslation | "failed" | null> => {
  const key = lyricsTranslationKey(song, target);
  const stored = await service.read(key).catch(() => null);
  const saved = savedLyricsTranslation(stored, lines);
  if (saved !== null) return saved;
  if (stored !== null) await service.drop(key).catch(() => undefined);

  const request = lyricsTranslationRequest(lines, target);
  if (request === null) return null;
  let reply: unknown;
  try {
    reply = await service.post(request.url, request.body);
  } catch (cause) {
    console.warn("[wave] couldn't translate the lyrics", cause);
    return "failed";
  }
  const translation = parseLyricsTranslation(lines, target, reply);
  if (translation === null) {
    console.warn("[wave] Google Translate's reply couldn't be read");
    return "failed";
  }
  await service
    .keep(key, storedLyricsTranslation(lines, translation))
    .catch((cause: unknown) => console.warn("[wave] couldn't save the translation", cause));
  return translation;
};
