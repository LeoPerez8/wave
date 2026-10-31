/**
 * Find in Playlist: narrows a playlist's songs (a local playlist's, a YT
 * Music playlist's, Favorites) to those a query finds, as you type.
 *
 * It matches as Search does (`search.ts`): case, accents and punctuation are
 * ignored and every word of the query has to start a word of the song's
 * title, artist or album, in any order. Unlike Search it doesn't rank: the
 * songs found stay in the playlist's order, given by their place in it, so a
 * tap plays the whole playlist from the song.
 *
 * The Library's Songs and Artists lists find the same way (#530): Songs by
 * each song's title, artist and album, Artists by the artist's name alone
 * (`artistFindText`), each keeping its list's order. Albums find by title and
 * album artist (`albumFindText`), Genres by name (`genreFindText`) (#753),
 * Playlists by name alone (`playlistFindText`) (#754). The Library's artist
 * page finds its songs as Songs does (#828).
 */

import { en } from "./catalogueEn.ts";
import { catalogueOf, type AppLanguage } from "./localisation.ts";
import {
  memoize,
  normalizeSearchText,
  prepareSearchEntry,
  searchIndexOver,
  type Indexed,
  type SearchEntry,
} from "./search.ts";

/** What finds a song in a playlist; null for an entry nothing finds. */
export interface PlaylistFindText {
  readonly title: string;
  readonly artist?: string | null | undefined;
  readonly album?: string | null | undefined;
}

export interface PlaylistFinder {
  /**
   * The places in the playlist (indices, in playlist order) of the songs
   * [query] finds, or null for a query with nothing to match (blank, or
   * punctuation only): the whole list shows.
   */
  readonly find: (query: string) => readonly number[] | null;
}

interface Entry extends SearchEntry {
  readonly index: number;
}

/** What the field says before anything is typed. */
export const FIND_IN_PLAYLIST_PLACEHOLDER = en.library.find.playlist;

/** What the page says when the query finds no song. */
export const FIND_IN_PLAYLIST_NO_MATCH = en.library.noMatch.playlist;

/**
 * A list Find narrows: a playlist (Favorites too), the Library's Songs,
 * Artists, Albums, Genres or Playlists, or an artist page's songs.
 */
export type FindableListKind =
  "playlist" | "songs" | "artists" | "albums" | "genres" | "playlists" | "artist";

/** What [list]'s field says before anything is typed ("Find in Songs"). */
export const findPlaceholder = (list: FindableListKind, language: AppLanguage = "en"): string =>
  catalogueOf(language).library.find[list];

/** What [list] says under its field when the query finds nothing ("No artists match"). */
export const findNoMatch = (list: FindableListKind, language: AppLanguage = "en"): string =>
  catalogueOf(language).library.noMatch[list];

/** What finds an artist in the Library's Artists: its name, matched as a song's title is. */
export const artistFindText = (name: string): PlaylistFindText => ({ title: name });

/** What finds an album in the Library's Albums: its title and its album artist. */
export const albumFindText = (title: string, albumArtist: string): PlaylistFindText => ({
  title,
  artist: albumArtist,
});

/** What finds a genre in the Library's Genres: its name. */
export const genreFindText = (name: string): PlaylistFindText => ({ title: name });

/** What finds a playlist in the Library's Playlists: its name alone, matched as a song's title is. */
export const playlistFindText = (name: string): PlaylistFindText => ({ title: name });

/**
 * Whether [query] has anything to find by: false for a blank or
 * punctuation-only one, which leaves the whole list showing.
 */
export const hasFindQuery = (query: string): boolean => normalizeSearchText(query) !== "";

/** The rows a list shows while Find in Playlist narrows it. */
export interface FoundInPlaylist<T> {
  /** The songs shown, in playlist order: all of them while nothing is typed. */
  readonly songs: readonly T[];
  /** The place in the playlist of the row shown at [index], for a tap to play from. */
  readonly placeOf: (index: number) => number;
}

/**
 * What a list shows of [songs] when [found] (a finder's answer) narrows it:
 * the whole list while it's null.
 */
export const foundInPlaylist = <T>(
  songs: readonly T[],
  found: readonly number[] | null,
): FoundInPlaylist<T> =>
  found === null
    ? { songs, placeOf: (index) => index }
    : {
        songs: found.flatMap((place) => (place in songs ? [songs[place]!] : [])),
        placeOf: (index) => found[index] ?? index,
      };

/**
 * What sits under the field: "header", the list's own head, while nothing is
 * typed; "noMatch" ("No songs match") once the query finds nothing in a list
 * that's all in ([allRead]); "none" otherwise, over the songs found. A YT
 * Music playlist whose pages are still arriving never says "No songs match":
 * its skeleton rows stand for the songs still to come.
 */
export const findInPlaylistHead = (
  found: readonly number[] | null,
  allRead: boolean,
): "header" | "noMatch" | "none" =>
  found === null ? "header" : found.length === 0 && allRead ? "noMatch" : "none";

/**
 * A finder over [songs], in playlist order. [describe] says what finds each
 * one. Build it once per list; each query then reuses the prepared text.
 */
export const createPlaylistFinder = <T>(
  songs: readonly T[],
  describe: (song: T) => PlaylistFindText | null,
): PlaylistFinder => finishFinder(playlistFinderSteps(songs, describe));

const finishFinder = (steps: Generator<void, PlaylistFinder>): PlaylistFinder => {
  for (;;) {
    const next = steps.next();
    if (next.done === true) return next.value;
  }
};

/** Builds [createPlaylistFinder]'s finder a song at a step. */
function* playlistFinderSteps<T>(
  songs: readonly T[],
  describe: (song: T) => PlaylistFindText | null,
): Generator<void, PlaylistFinder> {
  const normalize = memoize(normalizeSearchText);
  const prepared: Indexed<Entry>[] = [];
  for (const [index, song] of songs.entries()) {
    const text = describe(song);
    if (text !== null) {
      const also: string[] = [];
      if (text.artist != null && text.artist !== "") also.push(text.artist);
      if (text.album != null && text.album !== "") also.push(text.album);
      const entry: Entry = { kind: "song", name: text.title, also, index };
      prepared.push(prepareSearchEntry(entry, 0, prepared.length, normalize));
    }
    yield;
  }
  const search = searchIndexOver(prepared);
  return {
    find: (query) => {
      if (!hasFindQuery(query)) return null;
      const results = search.search(query);
      const found = results.groups.flatMap((group) => group.items.map((entry) => entry.index));
      // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array; Hermes lacks toSorted
      return found.sort((a, b) => a - b);
    },
  };
}

/** What a song list shows for a query: the places found, and the rows. */
export interface ShownInPlaylist<T> extends FoundInPlaylist<T> {
  /** The places in the list of the songs found, or null while the whole list shows. */
  readonly found: readonly number[] | null;
}

/** A song list that Find in Playlist may narrow. */
export interface FindableList<T> {
  /** What the list shows while [query] is typed. */
  readonly show: (query: string) => ShownInPlaylist<T>;
  /**
   * Prepares for the first query a song at a step, to run between frames. A
   * query that comes first finishes it at once, and these steps then just end.
   */
  readonly prepare: () => Generator<void, void>;
}

/**
 * A song list over [songs], findable or not. With Find on ([findable]), each
 * query narrows it as a finder does (`createPlaylistFinder`); nothing is
 * prepared until a query or `prepare` asks, so a long list opens without
 * folding every song's text in its first render (#842). With Find off, nothing
 * for Find is ever prepared and the list always shows all its songs in their
 * order.
 */
export const createFindableList = <T>(
  songs: readonly T[],
  describe: (song: T) => PlaylistFindText | null,
  findable: boolean,
): FindableList<T> => {
  const whole: ShownInPlaylist<T> = { found: null, ...foundInPlaylist(songs, null) };
  if (!findable) {
    return {
      show: () => whole,
      prepare: function* () {},
    };
  }
  let build: Generator<void, PlaylistFinder> | null = null;
  let finder: PlaylistFinder | null = null;
  const sharedBuild = (): Generator<void, PlaylistFinder> =>
    (build ??= playlistFinderSteps(songs, describe));
  return {
    show: (query) => {
      if (!hasFindQuery(query)) return whole;
      finder ??= finishFinder(sharedBuild());
      const found = finder.find(query);
      return { found, ...foundInPlaylist(songs, found) };
    },
    prepare: function* () {
      const building = sharedBuild();
      while (finder === null) {
        const next = building.next();
        if (next.done === true) {
          finder = next.value;
          return;
        }
        yield;
      }
    },
  };
};
