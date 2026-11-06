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

/**
 * The most all-time counted plays the owner's most played artist can have for
 * the owner to be a light listener, whose suggestions come from what they keep.
 */
export const LIGHT_LISTENER_PLAYS = 10;

/** An artist a kept song credits, with what the app shows them by. */
export interface KeptSongArtist<A> {
  readonly name: string;
  readonly item: A;
}

/**
 * A song the owner keeps: [id] tells it from the others, and [artists] are
 * every artist its credit names, as Stats credits them.
 */
export interface KeptSong<A> {
  readonly id: string;
  readonly artists: readonly KeptSongArtist<A>[];
}

/** What the owner keeps: their Library's songs, and each playlist's (Favorites one of them). */
export interface KeptSongs<A> {
  readonly library: readonly KeptSong<A>[];
  readonly playlists: readonly (readonly KeptSong<A>[])[];
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

/** Ties go by name, as the Library sorts names. */
const byName = (a: { readonly name: string }, b: { readonly name: string }): number =>
  compareStrings(sortKey(a.name), sortKey(b.name)) || compareStrings(a.name, b.name);

/**
 * Whether the owner is a light listener: their most played artist, as Stats
 * lists [allTime]'s, has `LIGHT_LISTENER_PLAYS` all-time counted plays or fewer.
 */
export const lightListener = (allTime: readonly { readonly countedPlays: number }[]): boolean =>
  allTime.every((artist) => artist.countedPlays <= LIGHT_LISTENER_PLAYS);

/** One artist's suggestion as a light listener's list builds it. */
interface KeptArtist<A> {
  readonly key: string;
  name: string;
  item: A;
  /** The counted plays of the spelling [name] is, which leads while no other has more. */
  leadPlays: number;
  countedPlays: number;
  library: number;
  playlists: number;
}

/**
 * A light listener's suggestions: every artist they played or keep a song
 * of, by score (Library songs, then playlist entries), then counted plays,
 * then name. An artist with a score says what they keep; one with plays alone
 * says how often they were played.
 */
const fromKept = <A>(
  allTime: readonly FollowSuggestionPlays<A>[],
  kept: KeptSongs<A>,
  taken: ReadonlySet<string>,
  strings: Catalogue,
): FollowSuggestion<A>[] => {
  const artists = new Map<string, KeptArtist<A>>();
  const artistOf = (artist: KeptSongArtist<A>): KeptArtist<A> | undefined => {
    if (!suggestible(artist.name)) return undefined;
    const key = followArtistKey(artist.name);
    if (taken.has(key)) return undefined;
    const known = artists.get(key);
    if (known !== undefined) return known;
    const added: KeptArtist<A> = {
      key,
      name: artist.name,
      item: artist.item,
      leadPlays: 0,
      countedPlays: 0,
      library: 0,
      playlists: 0,
    };
    artists.set(key, added);
    return added;
  };
  // Plays first, so namesakes go by the most played spelling.
  for (const played of allTime) {
    if (played.countedPlays <= 0) continue;
    const artist = artistOf(played);
    if (artist === undefined) continue;
    if (played.countedPlays > artist.leadPlays) {
      artist.name = played.name;
      artist.item = played.item;
      artist.leadPlays = played.countedPlays;
    }
    artist.countedPlays += played.countedPlays;
  }
  // A song counts once for each artist it credits, however many namesakes name them.
  const credit = (songs: readonly KeptSong<A>[], add: (artist: KeptArtist<A>) => void) => {
    const counted = new Set<string>();
    for (const song of songs)
      for (const named of song.artists) {
        const artist = artistOf(named);
        if (artist === undefined || counted.has(`${artist.key}\n${song.id}`)) continue;
        counted.add(`${artist.key}\n${song.id}`);
        add(artist);
      }
  };
  credit(kept.library, (artist) => artist.library++);
  for (const playlist of kept.playlists) credit(playlist, (artist) => artist.playlists++);
  const score = (artist: KeptArtist<A>) => artist.library + artist.playlists;
  return [...artists.values()]
    .filter((artist) => score(artist) > 0 || artist.countedPlays > 0)
    .sort((a, b) => score(b) - score(a) || b.countedPlays - a.countedPlays || byName(a, b))
    .map((artist) => ({
      key: artist.key,
      name: artist.name,
      item: artist.item,
      countedPlays: artist.countedPlays,
      line:
        score(artist) > 0
          ? strings.shows.keptSongs(artist.library, artist.playlists)
          : strings.shows.allTimePlays(artist.countedPlays),
    }));
};

/**
 * The first [shown] suggestions, and whether more are left for Show More.
 * Usually, artists with counted plays in the last 90 days ([recent]) by those
 * plays, then the other played artists by all-time counted plays ([allTime]).
 * For a light listener (no artist above `LIGHT_LISTENER_PLAYS` all-time
 * counted plays), one list from what the owner keeps ([kept]) instead, by
 * score: each Library song an artist's credit names is worth 1, and each
 * playlist adds 1 per song of theirs it holds, a song counting once per
 * playlist; then by counted plays. Ties go by name. Artists whose follow key
 * is in [excluded] (followed ones) or [dismissed] (suggestions the owner
 * dismissed, for good, whether or not they follow the artist later) are left
 * out, so the next one takes the place of a followed or dismissed suggestion;
 * taking a key out of [dismissed] (Undo) puts the artist back in their place.
 */
export const followSuggestions = <A>(input: {
  readonly recent: readonly FollowSuggestionPlays<A>[];
  readonly allTime: readonly FollowSuggestionPlays<A>[];
  readonly excluded: Iterable<string>;
  readonly dismissed?: Iterable<string>;
  readonly kept?: KeptSongs<A>;
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
      .sort((a, b) => b.countedPlays - a.countedPlays || byName(a, b));
  };
  const usual = () => {
    const recent = ranked(input.recent, strings.shows.playsInLast90Days);
    for (const artist of recent) taken.add(artist.key);
    return [...recent, ...ranked(input.allTime, strings.shows.allTimePlays)];
  };
  const suggestions = lightListener(input.allTime)
    ? fromKept(input.allTime, input.kept ?? { library: [], playlists: [] }, taken, strings)
    : usual();
  return {
    suggestions: suggestions.slice(0, input.shown),
    more: suggestions.length > input.shown,
  };
};
