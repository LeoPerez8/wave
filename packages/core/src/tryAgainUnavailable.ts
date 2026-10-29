/**
 * Try Again on a playlist's "N unavailable" line (docs/spec.md, YT Music,
 * "Unavailable entries"): which of its unavailable entries are searched on
 * YouTube Music once more, and what each answer settles.
 */

import { catalogueOf, type AppLanguage } from "./localisation.ts";
import {
  playlistSongKey,
  type PlaylistItem,
  type PlaylistSong,
  type UnavailableSong,
} from "./playlistEntries.ts";
import {
  artistNames,
  spotifySearchQuery,
  spotifyYtMatch,
  type YtSongSearch,
} from "./spotifyImport.ts";
import type { YtSong } from "./ytMusic.ts";

/** One search Try Again asks: the entry, the song its source listed, and what is sent. */
export interface TryAgainSearch {
  readonly itemId: number;
  readonly song: UnavailableSong;
  /** The song's title and artists, as an import searched it (`spotifySearchQuery`). */
  readonly query: string;
}

/**
 * What Try Again searches of a playlist holding [entries] (in playlist
 * order): each entry a source listed that wasn't found on YouTube Music,
 * in that order. A local file on Spotify with no artist is never searched.
 */
export const tryAgainSearches = <S extends YtSong, L>(
  entries: readonly (PlaylistItem<S, L> & { readonly itemId: number })[],
): TryAgainSearch[] =>
  entries.flatMap((entry) =>
    entry.source === "unavailable" &&
    entry.song.reason === "notFound" &&
    artistNames(entry.song.artists).length > 0
      ? [{ itemId: entry.itemId, song: entry.song, query: spotifySearchQuery(entry.song) }]
      : [],
  );

/** A Try Again search and YouTube Music's answer to it. */
export interface TryAgainAnswered<S extends YtSong> {
  readonly search: TryAgainSearch;
  readonly answer: YtSongSearch<S>;
}

/** What Try Again's answers settle, and how many were found and how many searches failed. */
export interface TryAgainSettled<S extends YtSong> {
  /** Entries found: each becomes its YT Music song in its place. */
  readonly replace: readonly { readonly itemId: number; readonly song: S }[];
  /** Entries found as a song their playlist already holds: removed rather than doubled. */
  readonly drops: readonly number[];
  readonly found: number;
  readonly failed: number;
}

/**
 * What [answered] settles in a playlist holding [held]: an entry whose
 * answer has a result that is the recording (the first, by the rules imports
 * use, `spotifyYtMatch`) becomes that YT Music song in its place, unless the
 * playlist holds that song already or an earlier entry just became it: a
 * playlist never holds a song twice, so it's removed instead. An entry not
 * found stays unavailable, and so does one whose search failed (offline,
 * refused, YT Music off), counted as failed.
 */
export const tryAgainSettles = <S extends YtSong>(
  answered: readonly TryAgainAnswered<S>[],
  held: readonly PlaylistSong[],
): TryAgainSettled<S> => {
  const holds = new Set(held.map(playlistSongKey));
  const replace: { itemId: number; song: S }[] = [];
  const drops: number[] = [];
  let failed = 0;
  for (const { search, answer } of answered) {
    if (!answer.ok) {
      failed += 1;
      continue;
    }
    const song = spotifyYtMatch(search.song, answer.songs);
    if (song === null) continue;
    const key = playlistSongKey({ source: "stream", song });
    if (holds.has(key)) {
      drops.push(search.itemId);
      continue;
    }
    holds.add(key);
    replace.push({ itemId: search.itemId, song });
  }
  return { replace, drops, found: replace.length + drops.length, failed };
};

/**
 * What Try Again says once it ends: how many of the [searched] songs were
 * found ("Found 2 of 3"), and how many searches failed, if any.
 */
export const tryAgainNotice = (
  {
    searched,
    found,
    failed,
  }: {
    readonly searched: number;
    readonly found: number;
    readonly failed: number;
  },
  language: AppLanguage = "en",
): string => {
  const text = catalogueOf(language).library.unavailable;
  const line = text.found(found, searched);
  return failed === 0 ? line : `${line} · ${text.searchesFailed(failed)}`;
};
