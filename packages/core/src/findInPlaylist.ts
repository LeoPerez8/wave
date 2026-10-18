/**
 * Find in Playlist: narrows a playlist's songs (a local playlist's, a YT
 * Music playlist's, Favorites) to those a query finds, as you type.
 *
 * It matches as Search does (`search.ts`): case, accents and punctuation are
 * ignored and every word of the query has to start a word of the song's
 * title, artist or album, in any order. Unlike Search it doesn't rank: the
 * songs found stay in the playlist's order, given by their place in it, so a
 * tap plays the whole playlist from the song.
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
      if (normalizeSearchText(query) === "") return null;
      const results = index.search(query);
      const found = results.groups.flatMap((group) => group.items.map((entry) => entry.index));
      // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array; Hermes lacks toSorted
      return found.sort((a, b) => a - b);
    },
  };
};
