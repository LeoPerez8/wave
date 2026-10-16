/**
 * Search: finds songs, albums, artists, genres and playlists as you type.
 *
 * - Case, accents and punctuation are ignored; every word of the query has to
 *   start a word of the entry (`beyo` finds `Beyoncé`), in any order. A name
 *   split by punctuation is also found spelled as one word (`acdc`, `aha`).
 * - Songs are also found by their artist and album, albums by their artist.
 * - Best match first: the exact name, then names that start with the query,
 *   then names with the query's words elsewhere, then entries found by their
 *   artist or album. Equally good matches: artists, albums, songs, playlists,
 *   genres in that order, then the shorter name, then A–Z.
 */

import { compareStrings, foldAccentsAndCase } from "./library.ts";

export type SearchKind = "artist" | "album" | "song" | "playlist" | "genre";

/** Something search can find. */
export interface SearchEntry {
  readonly kind: SearchKind;
  /** What the entry is called: a song's title, an album's title, an artist's name… */
  readonly name: string;
  /** What else finds it, ranked below its name: a song's artist and album, an album's artist. */
  readonly also?: readonly string[] | undefined;
}

export interface SearchGroup<E extends SearchEntry> {
  readonly kind: SearchKind;
  /** The best matches, at most `limit` of them. */
  readonly items: readonly E[];
  /** How many entries of this type match. */
  readonly total: number;
}

export interface SearchResults<E extends SearchEntry> {
  /** The best match of any type, or null when nothing matches. */
  readonly top: E | null;
  /** One group per type with matches, best match first; the groups ordered by their best match. */
  readonly groups: readonly SearchGroup<E>[];
}

export interface SearchOptions<E extends SearchEntry = SearchEntry> {
  /** The most matches to return per type (all of them by default). */
  readonly limit?: number | undefined;
  /**
   * Entries this search leaves out, as if the index didn't have them: they're
   * neither results nor counted, and don't make the top result or order the
   * groups.
   */
  readonly skip?: ((entry: E) => boolean) | undefined;
}

export interface SearchIndex<E extends SearchEntry> {
  readonly search: (query: string, options?: SearchOptions<E>) => SearchResults<E>;
}

const APOSTROPHES = /['’ʼ`´]/g;
const SEPARATORS = /[^\p{L}\p{N}]+/gu;
const LEADING_ARTICLE = /^(?:the|a|an) (?=\S)/;

/**
 * Search text: case and accents folded, apostrophes dropped (`Don't` → `dont`)
 * and any other punctuation turned into a word break (`AC/DC` → `ac dc`).
 */
export const normalizeSearchText = (text: string): string =>
  foldAccentsAndCase(text.replace(APOSTROPHES, "")).replace(SEPARATORS, " ").trim();

/** How well an entry matches, best first. */
const Tier = {
  /** The name is the query (ignoring a leading article, or spaced differently). */
  exact: 0,
  /** The name starts with the query's words. */
  startsWithWords: 1,
  /** The name starts with the query, the last word unfinished. */
  startsWith: 2,
  /** Every word of the query starts a word of the name. */
  nameWords: 3,
  /** Every word of the query starts a word of the name, artist or album. */
  anyWords: 4,
} as const;

type Tier = (typeof Tier)[keyof typeof Tier];

interface Indexed<E> {
  readonly entry: E;
  readonly order: number;
  /** Normalized name. */
  readonly name: string;
  /** Normalized name without a leading article. */
  readonly bare: string;
  /** The name's words joined without spaces. */
  readonly compact: string;
  /** ` ` + the name, so ` ${word}` is found where a name word starts with `word`. */
  readonly nameWords: string;
  /** ` ` + the name, then the `also` texts. */
  readonly allWords: string;
}

interface Query {
  readonly text: string;
  readonly compact: string;
  /** Each word of the query with a leading space. */
  readonly wordStarts: readonly string[];
}

const startsWords = (name: string, query: string): boolean =>
  name.startsWith(query) && (name.length === query.length || name.charAt(query.length) === " ");

const hasEveryWord = (words: string, wordStarts: readonly string[]): boolean => {
  for (const start of wordStarts) if (!words.includes(start)) return false;
  return true;
};

/**
 * The entry's tier for the query, or null when it doesn't match. An entry
 * matches when every query word starts one of its words, or when its name
 * spelled as one word starts with the query spelled as one word.
 *
 * Matching only ever narrows as the query grows (a query that extends another
 * matches a subset of its entries), which is what lets typing reuse the
 * previous matches.
 */
const tierOf = <E>(item: Indexed<E>, query: Query): Tier | null => {
  const { name, bare, compact } = item;
  const joined = compact.startsWith(query.compact);
  if (!joined && !hasEveryWord(item.allWords, query.wordStarts)) return null;
  if (name === query.text || bare === query.text || compact === query.compact) return Tier.exact;
  if (startsWords(name, query.text) || startsWords(bare, query.text)) return Tier.startsWithWords;
  if (joined || name.startsWith(query.text) || bare.startsWith(query.text)) return Tier.startsWith;
  if (hasEveryWord(item.nameWords, query.wordStarts)) return Tier.nameWords;
  return Tier.anyWords;
};

interface Hit<E> {
  readonly item: Indexed<E>;
  readonly tier: Tier;
}

/** Which type wins between equally good matches. */
const KIND_ORDER: Readonly<Record<SearchKind, number>> = {
  artist: 0,
  album: 1,
  song: 2,
  playlist: 3,
  genre: 4,
};

const compareHits = <E extends SearchEntry>(a: Hit<E>, b: Hit<E>): number =>
  a.tier - b.tier ||
  KIND_ORDER[a.item.entry.kind] - KIND_ORDER[b.item.entry.kind] ||
  a.item.name.length - b.item.name.length ||
  compareStrings(a.item.name, b.item.name) ||
  a.item.order - b.item.order;

/** Normalizes repeated text (artist and album names) once per index build. */
const memoize = (normalize: (text: string) => string): ((text: string) => string) => {
  const cache = new Map<string, string>();
  return (text) => {
    let normalized = cache.get(text);
    if (normalized === undefined) {
      normalized = normalize(text);
      cache.set(text, normalized);
    }
    return normalized;
  };
};

/** The best `limit` hits of one type, kept in order, and how many there were. */
interface Ranking<E> {
  readonly hits: Hit<E>[];
  total: number;
}

const addHit = <E extends SearchEntry>(ranking: Ranking<E>, hit: Hit<E>, limit: number): void => {
  ranking.total++;
  const { hits } = ranking;
  if (hits.length >= limit && compareHits(hit, hits[hits.length - 1]!) >= 0) return;
  let low = 0;
  let high = hits.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (compareHits(hits[mid]!, hit) <= 0) low = mid + 1;
    else high = mid;
  }
  hits.splice(low, 0, hit);
  if (hits.length > limit) hits.pop();
};

const NOTHING: SearchResults<never> = { top: null, groups: [] };

/** How many recent queries keep their matches for narrowing. */
const RECENT_QUERIES = 16;

/**
 * Indexes entries for searching. Build the index once per library change;
 * each search then only compares prepared text, and a query typed onwards
 * from the previous one only re-checks the previous matches.
 */
export const createSearchIndex = <E extends SearchEntry>(entries: readonly E[]): SearchIndex<E> => {
  const normalize = memoize(normalizeSearchText);
  const indexed = entries.map((entry, order): Indexed<E> => {
    const name = normalize(entry.name);
    let allWords = ` ${name}`;
    for (const text of entry.also ?? []) allWords += ` ${normalize(text)}`;
    return {
      entry,
      order,
      name,
      bare: name.replace(LEADING_ARTICLE, ""),
      compact: name.replaceAll(" ", ""),
      nameWords: ` ${name}`,
      allWords,
    };
  });

  // The matches of recent queries, newest last. Typing onwards narrows the
  // latest; deleting back falls back to an earlier, shorter one.
  const recent: { readonly text: string; readonly matches: readonly Indexed<E>[] }[] = [];
  const candidatesFor = (text: string): readonly Indexed<E>[] => {
    let best: (typeof recent)[number] | undefined;
    for (const query of recent)
      if (
        text.startsWith(query.text) &&
        (best === undefined || query.text.length > best.text.length)
      )
        best = query;
    return best?.matches ?? indexed;
  };

  return {
    search: (text, options = {}) => {
      const normalized = normalizeSearchText(text);
      if (normalized === "") return NOTHING;
      const words = normalized.split(" ");
      const query: Query = {
        text: normalized,
        compact: words.join(""),
        wordStarts: words.map((word) => ` ${word}`),
      };
      const limit = Math.max(1, options.limit ?? Number.POSITIVE_INFINITY);
      const { skip } = options;

      const candidates = candidatesFor(normalized);
      const matches: Indexed<E>[] = [];
      const byKind = new Map<SearchKind, Ranking<E>>();
      for (const item of candidates) {
        const tier = tierOf(item, query);
        if (tier === null) continue;
        matches.push(item);
        if (skip?.(item.entry) === true) continue;
        let ranking = byKind.get(item.entry.kind);
        if (ranking === undefined) {
          ranking = { hits: [], total: 0 };
          byKind.set(item.entry.kind, ranking);
        }
        addHit(ranking, { item, tier }, limit);
      }
      const same = recent.findIndex((earlier) => earlier.text === normalized);
      if (same >= 0) recent.splice(same, 1);
      recent.push({ text: normalized, matches });
      if (recent.length > RECENT_QUERIES) recent.shift();

      // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array; Hermes lacks toSorted
      const ranked = [...byKind.values()].sort((a, b) => compareHits(a.hits[0]!, b.hits[0]!));
      return {
        top: ranked[0]?.hits[0]?.item.entry ?? null,
        groups: ranked.map((ranking) => ({
          kind: ranking.hits[0]!.item.entry.kind,
          items: ranking.hits.map((hit) => hit.item.entry),
          total: ranking.total,
        })),
      };
    },
  };
};

/** How many recent searches are kept. */
export const RECENT_SEARCHES = 10;

/**
 * Adds a search to the recent searches, newest first. A search made again
 * (ignoring case, accents and punctuation) moves to the top with its newest
 * spelling; searches without letters or digits aren't kept.
 */
export const rememberSearch = (recent: readonly string[], query: string): readonly string[] => {
  const key = normalizeSearchText(query);
  if (key === "") return recent;
  const others = recent.filter((search) => normalizeSearchText(search) !== key);
  return [query.replace(/\s+/g, " ").trim(), ...others].slice(0, RECENT_SEARCHES);
};
