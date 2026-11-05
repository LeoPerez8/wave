/* oxlint-disable unicorn/no-array-sort -- Hermes lacks the copying array methods; the receiver is a fresh array. */
/**
 * Settings › Followed Artists' Suggested section: the artists the owner plays
 * and doesn't follow, recent listening first.
 */
import { en, type Catalogue } from "./catalogueEn.ts";
import { artistPhotoQuery } from "./artistPhoto.ts";
import { followArtistKey } from "./followedArtists.ts";
import { compareStrings, sortKey } from "./library.ts";
import type { StatsWindow } from "./stats.ts";

/** An artist's counted plays, as Stats counts them, with what the app shows them by. */
export interface FollowSuggestionPlays<A> {
  readonly name: string;
  readonly countedPlays: number;
  readonly item: A;
}

/** One suggestion: the artist, their plays and the line saying why they're suggested. */
export interface FollowSuggestion<A> {
  /** The artist's follow key (`followArtistKey`). */
  readonly key: string;
  readonly name: string;
  readonly item: A;
  readonly countedPlays: number;
  readonly line: string;
}

/** How many suggestions the section starts with, and how many more each Show More adds. */
export const FOLLOW_SUGGESTIONS_PAGE = 5;

const DAY = 86_400_000;

/** The last 90 days up to [now]: the recent listening suggestions rank by first. */
export const followSuggestionsWindow = (now: number): StatsWindow => ({
  from: now - 90 * DAY,
  to: now,
});

/** "Various Artists", "Unknown Artist" and names without letters aren't anyone to follow. */
const suggestible = (name: string): boolean =>
  artistPhotoQuery(name) !== null && /\p{L}/u.test(name);

/**
 * The first [shown] suggestions, and whether more are left for Show More:
 * artists with counted plays in the last 90 days ([recent]) by those plays,
 * then the other played artists by all-time counted plays ([allTime]). Ties
 * go by name. Artists whose follow key is in [excluded] (followed ones) or
 * [dismissed] (suggestions the owner dismissed, for good, whether or not they
 * follow the artist later) are left out, so the next one takes the place of
 * a followed or dismissed suggestion; taking a key out of [dismissed] (Undo)
 * puts the artist back in their place.
 */
export const followSuggestions = <A>(input: {
  readonly recent: readonly FollowSuggestionPlays<A>[];
  readonly allTime: readonly FollowSuggestionPlays<A>[];
  readonly excluded: Iterable<string>;
  readonly dismissed?: Iterable<string>;
  readonly shown: number;
  readonly strings?: Catalogue;
}): { readonly suggestions: readonly FollowSuggestion<A>[]; readonly more: boolean } => {
  const strings = input.strings ?? en;
  const taken = new Set(input.excluded);
  for (const key of input.dismissed ?? []) taken.add(key);
  const ranked = (
    artists: readonly FollowSuggestionPlays<A>[],
    line: (count: number) => string,
  ) => {
    // Namesakes share a follow: their plays add up under the most played one's name.
    const byKey = new Map<string, { lead: FollowSuggestionPlays<A>; countedPlays: number }>();
    for (const artist of artists) {
      if (artist.countedPlays <= 0 || !suggestible(artist.name)) continue;
      const key = followArtistKey(artist.name);
      if (taken.has(key)) continue;
      const same = byKey.get(key);
      byKey.set(key, {
        lead:
          same === undefined || artist.countedPlays > same.lead.countedPlays ? artist : same.lead,
        countedPlays: (same?.countedPlays ?? 0) + artist.countedPlays,
      });
    }
    return [...byKey]
      .map(([key, { lead, countedPlays }]) => ({
        key,
        name: lead.name,
        item: lead.item,
        countedPlays,
        line: line(countedPlays),
      }))
      .sort(
        (a, b) =>
          b.countedPlays - a.countedPlays ||
          compareStrings(sortKey(a.name), sortKey(b.name)) ||
          compareStrings(a.name, b.name),
      );
  };
  const recent = ranked(input.recent, strings.shows.playsInLast90Days);
  for (const artist of recent) taken.add(artist.key);
  const suggestions = [...recent, ...ranked(input.allTime, strings.shows.allTimePlays)];
  return {
    suggestions: suggestions.slice(0, input.shown),
    more: suggestions.length > input.shown,
  };
};
