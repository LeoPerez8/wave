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
 * The Library's Songs, Artists and Playlists lists find the same way (#530,
 * #754): Songs by each song's title, artist and album, Artists by the
 * artist's name alone (`artistFindText`), Playlists by the playlist's name
 * alone (`playlistFindText`), each keeping its list's order.
 */

import { createSearchIndex, normalizeSearchText, type SearchEntry } from "./search.ts";

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
export const FIND_IN_PLAYLIST_PLACEHOLDER = "Find in Playlist";

/** What the page says when the query finds no song. */
export const FIND_IN_PLAYLIST_NO_MATCH = "No songs match";

/**
 * A list Find narrows: a playlist (Favorites too), or the Library's Songs,
 * Artists or Playlists.
 */
export type FindableListKind = "playlist" | "songs" | "artists" | "playlists";

/** What each list's field says before anything is typed, and under it when nothing is found. */
const FIND_WORDS: Readonly<
  Record<FindableListKind, { readonly placeholder: string; readonly noMatch: string }>
> = {
  playlist: { placeholder: FIND_IN_PLAYLIST_PLACEHOLDER, noMatch: FIND_IN_PLAYLIST_NO_MATCH },
  songs: { placeholder: "Find in Songs", noMatch: FIND_IN_PLAYLIST_NO_MATCH },
  artists: { placeholder: "Find in Artists", noMatch: "No artists match" },
  playlists: { placeholder: "Find in Playlists", noMatch: "No playlists match" },
};

/** What [list]'s field says before anything is typed ("Find in Songs"). */
export const findPlaceholder = (list: FindableListKind): string => FIND_WORDS[list].placeholder;

/** What [list] says under its field when the query finds nothing ("No artists match"). */
export const findNoMatch = (list: FindableListKind): string => FIND_WORDS[list].noMatch;

/** What finds an artist in the Library's Artists: its name, matched as a song's title is. */
export const artistFindText = (name: string): PlaylistFindText => ({ title: name });

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
): PlaylistFinder => {
  const entries: Entry[] = [];
  songs.forEach((song, index) => {
    const text = describe(song);
    if (text === null) return;
    const also: string[] = [];
    if (text.artist != null && text.artist !== "") also.push(text.artist);
    if (text.album != null && text.album !== "") also.push(text.album);
    entries.push({ kind: "song", name: text.title, also, index });
  });
  const index = createSearchIndex(entries);
  return {
    find: (query) => {
      if (!hasFindQuery(query)) return null;
      const results = index.search(query);
      const found = results.groups.flatMap((group) => group.items.map((entry) => entry.index));
      // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array; Hermes lacks toSorted
      return found.sort((a, b) => a - b);
    },
  };
};

/** What a song list shows for a query: the places found, and the rows. */
export interface ShownInPlaylist<T> extends FoundInPlaylist<T> {
  /** The places in the list of the songs found, or null while the whole list shows. */
  readonly found: readonly number[] | null;
}

/** A song list that Find in Playlist may narrow. */
export interface FindableList<T> {
  /** What the list shows while [query] is typed. */
  readonly show: (query: string) => ShownInPlaylist<T>;
}

/**
 * A song list over [songs], findable or not. With Find on ([findable]), each
 * query narrows it as a finder does (`createPlaylistFinder`). With Find off,
 * nothing for Find is prepared and the list always shows all its songs in
 * their order.
 */
export const createFindableList = <T>(
  songs: readonly T[],
  describe: (song: T) => PlaylistFindText | null,
  findable: boolean,
): FindableList<T> => {
  if (!findable) {
    const whole: ShownInPlaylist<T> = { found: null, ...foundInPlaylist(songs, null) };
    return { show: () => whole };
  }
  const finder = createPlaylistFinder(songs, describe);
  return {
    show: (query) => {
      const found = finder.find(query);
      return { found, ...foundInPlaylist(songs, found) };
    },
  };
};
