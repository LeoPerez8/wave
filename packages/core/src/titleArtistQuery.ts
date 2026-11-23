/**
 * A Search query that names a song by its title with its artist as a hint ("try my luck wayV",
 * ticket #1470): that song is Search's top result, and the query isn't read as a lyric phrase.
 */

import { titleName } from "./lyricsAndGenre.ts";
import { normalizeSearchText } from "./search.ts";

/** What naming a song compares: its title and its artists' names. */
export interface NamedSong {
  readonly title: string;
  /** Its artists' names; one name may credit several ("A feat. B", "A, B"). */
  readonly artists: readonly string[];
}

const LEADING_ARTICLE = /^(?:the|a|an) (?=\S)/;
const ARTICLES = new Set(["the", "a", "an"]);

/** How many words make a query a lyric phrase, when it doesn't name a song. */
const LYRIC_PHRASE_WORDS = 3;

const wordsOf = (text: string): string[] => normalizeSearchText(text).split(" ").filter(Boolean);

/** The spellings of a title the query's title words may equal: as written, or without its notes. */
const titleSpellings = (title: string): Set<string> => {
  const spellings = new Set<string>();
  for (const spelling of [normalizeSearchText(title), normalizeSearchText(titleName(title))]) {
    if (spelling === "") continue;
    spellings.add(spelling);
    spellings.add(spelling.replace(LEADING_ARTICLE, ""));
    spellings.add(spelling.replaceAll(" ", ""));
  }
  return spellings;
};

/**
 * Whether [words] are the song's artist: each a whole word of one of its artists' names, or
 * together one artist's name written as one word (`acdc` for AC/DC). Articles alone aren't.
 */
const namesArtist = (words: readonly string[], artists: readonly string[]): boolean => {
  if (words.every((word) => ARTICLES.has(word))) return false;
  const names = artists.map(normalizeSearchText).filter((name) => name !== "");
  const artistWords = new Set(names.flatMap((name) => name.split(" ")));
  if (words.every((word) => artistWords.has(word))) return true;
  const joined = words.join("");
  return names.some((name) => name.replaceAll(" ", "") === joined);
};

/**
 * Whether [query] is [song]'s whole title together with words of its artists, before or after
 * it ("try my luck wayV", "wayV try my luck"). Case, accents and punctuation are ignored as Search
 * ignores them; the title may leave out a featuring or version note ("(feat. X)",
 * "- Remastered") and a leading article. The title alone or the artist alone doesn't name it.
 */
export const queryNamesSong = (query: string, song: NamedSong): boolean => {
  const words = wordsOf(query);
  if (words.length < 2) return false;
  const titles = titleSpellings(song.title);
  for (let split = 1; split < words.length; split++) {
    const before = words.slice(0, split);
    const after = words.slice(split);
    if (titles.has(before.join(" ")) && namesArtist(after, song.artists)) return true;
    if (titles.has(after.join(" ")) && namesArtist(before, song.artists)) return true;
  }
  return false;
};

/** The first of [songs] that [query] names (`queryNamesSong`), or null. */
export const songNamedByQuery = <S>(
  query: string,
  songs: Iterable<S>,
  describe: (song: S) => NamedSong,
): S | null => {
  if (wordsOf(query).length < 2) return null;
  for (const song of songs) if (queryNamesSong(query, describe(song))) return song;
  return null;
};

/**
 * Whether Search reads [query] as a phrase from a song's lyrics: three or more words, unless a
 * song it shows is named by the query ([namesSong], `queryNamesSong`). A lyric phrase puts the
 * Lyrics section first and asks Genius; otherwise Lyrics follow Songs.
 */
export const isLyricPhraseQuery = (query: string, namesSong: boolean): boolean =>
  !namesSong && wordsOf(query).length >= LYRIC_PHRASE_WORDS;
