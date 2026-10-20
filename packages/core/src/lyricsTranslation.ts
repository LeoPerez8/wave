/**
 * Lyrics translated into the phone's language (docs/spec.md, "Lyrics
 * translation"), through Google Translate's keyless web endpoint: the
 * request, the reply read back line for line, the same-language check and
 * what the phone keeps of it.
 */

/** Google Translate's keyless endpoint: one translation per `q`, each with the language it found. */
const ENDPOINT = "https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto";

/** A request for a song's translation: POST [body], form-encoded, to [url]. */
export interface LyricsTranslationRequest {
  readonly url: string;
  readonly body: string;
}

/** The words of a line, or null for an empty line or an instrumental gap. */
const words = (line: string): string | null => {
  const text = line.trim();
  return text === "" ? null : text;
};

/**
 * The request translating [lines] (a song's lyric lines, in order) into
 * [target], Google's code for the phone's language (`lyricsTranslationTarget`):
 * each line with words is sent as its own text, so each comes back on its
 * own and the translation keeps the original's line breaks. Null when no
 * line has a word, and nothing is sent.
 */
export const lyricsTranslationRequest = (
  lines: readonly string[],
  target: string,
): LyricsTranslationRequest | null => {
  const texts = lines.map(words).filter((text) => text !== null);
  if (texts.length === 0) return null;
  return {
    url: `${ENDPOINT}&tl=${encodeURIComponent(target)}`,
    body: texts.map((text) => `q=${encodeURIComponent(text)}`).join("&"),
  };
};

/**
 * A song's lyrics in the phone's language: one translation per original
 * line, in the same order (null for an empty line, an instrumental gap, or
 * a line Google gave back unchanged), and the language Google found; or the
 * lyrics were already in the phone's [language], so nothing is shown under
 * them.
 */
export type LyricsTranslation =
  | {
      readonly kind: "translated";
      readonly from: string;
      readonly lines: readonly (string | null)[];
    }
  | { readonly kind: "sameLanguage"; readonly language: string };

/** One text's answer: `[translation, language found]`, or just the translation. */
const answerOf = (entry: unknown): { text: string; from: string | null } | null => {
  if (typeof entry === "string") return { text: entry, from: null };
  if (!Array.isArray(entry) || typeof entry[0] !== "string") return null;
  return { text: entry[0], from: typeof entry[1] === "string" ? entry[1] : null };
};

/**
 * [reply], Google's answer to `lyricsTranslationRequest(lines, target)`,
 * read back into one translation per line of [lines]. Null when it isn't a
 * reply to that request (the endpoint changed, or answered something
 * else): the lyrics then show untranslated, as when it can't be reached.
 */
export const parseLyricsTranslation = (
  lines: readonly string[],
  target: string,
  reply: unknown,
): LyricsTranslation | null => {
  const sent = lines.map(words);
  const count = sent.filter((text) => text !== null).length;
  if (!Array.isArray(reply) || reply.length !== count || count === 0) return null;
  const answers = reply.map(answerOf);
  if (answers.some((answer) => answer === null)) return null;
  const found = answers as readonly { text: string; from: string | null }[];
  const from = mostFound(found.map((answer) => answer.from));
  if (from !== null && sameLanguage(from, target))
    return { kind: "sameLanguage", language: target };
  let next = 0;
  const translated = sent.map((text) => {
    if (text === null) return null;
    const answer = found[next++]!.text.trim();
    return answer === "" || answer === text ? null : answer;
  });
  return { kind: "translated", from: from ?? "", lines: translated };
};

/** The language Google found for most lines (the first of those tied), null when it named none. */
const mostFound = (languages: readonly (string | null)[]): string | null => {
  const counts = new Map<string, number>();
  let most: string | null = null;
  for (const language of languages) {
    if (language === null) continue;
    const count = (counts.get(language) ?? 0) + 1;
    counts.set(language, count);
    if (most === null || count > counts.get(most)!) most = language;
  }
  return most;
};

/** Chinese in each script, which a reader of the other one still wants translated. */
const TRADITIONAL_CHINESE = new Set(["tw", "hk", "mo", "hant"]);
/** Google's older codes for languages that now have others. */
const RENAMED: Readonly<Record<string, string>> = { iw: "he", jw: "jv", in: "id" };

/** What [code] names, for comparing: its language, or Chinese with its script. */
const languageOf = (code: string): string => {
  const [language = "", ...rest] = code.toLowerCase().split(/[-_]/);
  if (language === "zh")
    return rest.some((part) => TRADITIONAL_CHINESE.has(part)) ? "zh-tw" : "zh-cn";
  return RENAMED[language] ?? language;
};

/** Whether [found], the language Google found, is [target], the phone's: regions aside. */
const sameLanguage = (found: string, target: string): boolean =>
  languageOf(found) === languageOf(target);

/**
 * Google Translate's code for the phone's language, from its [locale] (a
 * BCP 47 tag such as `pt-BR`): the language alone, but Chinese keeps its
 * script (`zh-CN`, `zh-TW`) and European Portuguese its region (`pt-PT`),
 * which Google translates into on their own. English when the phone names none.
 */
export const lyricsTranslationTarget = (locale: string): string => {
  const [language = "", ...rest] = locale.toLowerCase().split(/[-_]/);
  if (language === "" || language === "und" || !/^[a-z]{2,3}$/.test(language)) return "en";
  if (language === "zh") return languageOf(locale) === "zh-tw" ? "zh-TW" : "zh-CN";
  if (language === "pt" && rest.includes("pt")) return "pt-PT";
  return RENAMED[language] ?? language;
};

/** The languages Google Translate translates into, named in English. */
const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  af: "Afrikaans",
  am: "Amharic",
  ar: "Arabic",
  az: "Azerbaijani",
  be: "Belarusian",
  bg: "Bulgarian",
  bn: "Bengali",
  bs: "Bosnian",
  ca: "Catalan",
  cs: "Czech",
  cy: "Welsh",
  da: "Danish",
  de: "German",
  el: "Greek",
  en: "English",
  eo: "Esperanto",
  es: "Spanish",
  et: "Estonian",
  eu: "Basque",
  fa: "Persian",
  fi: "Finnish",
  fil: "Filipino",
  fr: "French",
  ga: "Irish",
  gl: "Galician",
  gu: "Gujarati",
  ha: "Hausa",
  haw: "Hawaiian",
  he: "Hebrew",
  hi: "Hindi",
  hr: "Croatian",
  ht: "Haitian Creole",
  hu: "Hungarian",
  hy: "Armenian",
  id: "Indonesian",
  ig: "Igbo",
  is: "Icelandic",
  it: "Italian",
  ja: "Japanese",
  jv: "Javanese",
  ka: "Georgian",
  kk: "Kazakh",
  km: "Khmer",
  kn: "Kannada",
  ko: "Korean",
  ku: "Kurdish",
  ky: "Kyrgyz",
  la: "Latin",
  lb: "Luxembourgish",
  lo: "Lao",
  lt: "Lithuanian",
  lv: "Latvian",
  mg: "Malagasy",
  mi: "Maori",
  mk: "Macedonian",
  ml: "Malayalam",
  mn: "Mongolian",
  mr: "Marathi",
  ms: "Malay",
  mt: "Maltese",
  my: "Burmese",
  ne: "Nepali",
  nl: "Dutch",
  no: "Norwegian",
  nb: "Norwegian",
  pa: "Punjabi",
  pl: "Polish",
  ps: "Pashto",
  pt: "Portuguese",
  ro: "Romanian",
  ru: "Russian",
  rw: "Kinyarwanda",
  sd: "Sindhi",
  si: "Sinhala",
  sk: "Slovak",
  sl: "Slovenian",
  sm: "Samoan",
  sn: "Shona",
  so: "Somali",
  sq: "Albanian",
  sr: "Serbian",
  st: "Sesotho",
  su: "Sundanese",
  sv: "Swedish",
  sw: "Swahili",
  ta: "Tamil",
  te: "Telugu",
  tg: "Tajik",
  th: "Thai",
  tk: "Turkmen",
  tl: "Filipino",
  tr: "Turkish",
  tt: "Tatar",
  ug: "Uyghur",
  uk: "Ukrainian",
  ur: "Urdu",
  uz: "Uzbek",
  vi: "Vietnamese",
  xh: "Xhosa",
  yi: "Yiddish",
  yo: "Yoruba",
  "zh-cn": "Chinese (Simplified)",
  "zh-tw": "Chinese (Traditional)",
  zu: "Zulu",
};

/** The language Google's [code] names, in English, for "already in <language>"; the code itself when unknown. */
export const lyricsTranslationLanguageName = (code: string): string =>
  LANGUAGE_NAMES[languageOf(code)] ?? code;

/**
 * Where the phone keeps [song]'s translation into [target]: [song] says
 * which song it is (a Library track's id, a non-D song's track id), so a
 * song's translation into another language is kept apart.
 */
export const lyricsTranslationKey = (song: string, target: string): string =>
  `lyrics.translation.${target}.${song}`;

/**
 * What the lyrics [lines] were when they were translated: their count and an
 * FNV-1a hash of their text, so a saved translation of other lyrics (Fix
 * Song, a new file) is never shown against these.
 */
const fingerprint = (lines: readonly string[]): string => {
  let hash = 0x811c9dc5;
  for (const char of lines.join("\n")) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${lines.length}:${hash.toString(16)}`;
};

/** What the phone keeps for [translation] of the lyrics [lines]. */
export const storedLyricsTranslation = (
  lines: readonly string[],
  translation: LyricsTranslation,
): string => JSON.stringify({ lyrics: fingerprint(lines), translation });

const isTranslation = (value: unknown): value is LyricsTranslation => {
  if (typeof value !== "object" || value === null) return false;
  const translation = value as Record<string, unknown>;
  if (translation["kind"] === "sameLanguage") return typeof translation["language"] === "string";
  return (
    translation["kind"] === "translated" &&
    typeof translation["from"] === "string" &&
    Array.isArray(translation["lines"]) &&
    translation["lines"].every((line) => line === null || typeof line === "string")
  );
};

/**
 * The translation [stored] (`storedLyricsTranslation`) keeps for the lyrics
 * [lines]; null when nothing is kept, it can't be read, or it was made for
 * other lyrics: the song's lyrics changed, and it's dropped.
 */
export const savedLyricsTranslation = (
  stored: string | null,
  lines: readonly string[],
): LyricsTranslation | null => {
  if (stored === null) return null;
  let saved: unknown;
  try {
    saved = JSON.parse(stored);
  } catch {
    return null;
  }
  if (typeof saved !== "object" || saved === null) return null;
  const { lyrics, translation } = saved as { lyrics?: unknown; translation?: unknown };
  if (lyrics !== fingerprint(lines) || !isTranslation(translation)) return null;
  if (translation.kind === "translated" && translation.lines.length !== lines.length) return null;
  return translation;
};
