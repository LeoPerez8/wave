/**
 * Unsearched entries (docs/spec.md, Glossary, "Unavailable entries"): the
 * songs a Spotify import listed that nothing has searched on YouTube Music
 * yet. What a search's answer settles of one, and what that does to the
 * playlists holding it. Playing, the background fill and downloads all ask
 * the same search and settle it the same way.
 */

import {
  playlistSongKey,
  type PlaylistSong,
  type UnavailableEntry,
  type UnsearchedSong,
} from "./playlistEntries.ts";
import type { SearchFailure } from "./searchAllowance.ts";
import { spotifySearchQuery, spotifyYtMatch, type YtSongSearch } from "./spotifyImport.ts";
import type { YtSong } from "./ytMusic.ts";

/** What an unsearched song is searched by: its title and artists, as an import searched. */
export const unsearchedSearchQuery = (song: UnsearchedSong): string => spotifySearchQuery(song);

/**
 * What a YouTube Music Songs search's answer settles of an unsearched song:
 * found, it becomes a YT Music entry; not found, an unavailable one ("Not
 * found on YouTube Music"); failed (offline, refused, an answer Wave can't
 * read, YT Music off), it stays unsearched.
 */
export type UnsearchedSettlement<S extends YtSong> =
  | { readonly kind: "found"; readonly becomes: { readonly source: "stream"; readonly song: S } }
  | { readonly kind: "notFound"; readonly becomes: UnavailableEntry }
  | { readonly kind: "failed"; readonly reason: SearchFailure };

/**
 * What [answer], the search for [song] (`unsearchedSearchQuery`), settles:
 * the first result that is the same recording, by the rules imports and
 * downloads use (`spotifyYtMatch`), or not found. A search that fails never
 * makes a song unavailable.
 */
export const settleUnsearched = <S extends YtSong>(
  song: UnsearchedSong,
  answer: YtSongSearch<S>,
): UnsearchedSettlement<S> => {
  if (!answer.ok) return { kind: "failed", reason: answer.reason };
  const match = spotifyYtMatch(song, answer.songs);
  if (match !== null) return { kind: "found", becomes: { source: "stream", song: match } };
  return {
    kind: "notFound",
    becomes: { source: "unavailable", song: { ...song, reason: "notFound" } },
  };
};

/** An entry of a playlist: its place, and the playlist. */
export interface PlaylistEntryPlace {
  readonly itemId: number;
  readonly playlistId: number;
}

/** What settling an unsearched song does to the entries holding it. */
export interface UnsearchedSettles {
  /** The entries that become the settled song, in their places. */
  readonly rewrites: readonly number[];
  /** The entries whose playlist holds that song already: removed rather than doubled. */
  readonly drops: readonly number[];
}

/**
 * What settling an unsearched song as [becomes] does to the entries holding
 * it, [holders], in every playlist: each becomes that song in its place,
 * except where its playlist holds the song already ([held]: what those
 * playlists hold that may be it, compared by `playlistSongKey`), or an
 * earlier holder of the same playlist just became it: a playlist never holds
 * a song twice, so that entry is removed instead.
 */
export const unsearchedSettles = (
  holders: readonly PlaylistEntryPlace[],
  becomes: PlaylistSong,
  held: readonly { readonly playlistId: number; readonly song: PlaylistSong }[],
): UnsearchedSettles => {
  const key = playlistSongKey(becomes);
  const holding = new Set(
    held.filter(({ song }) => playlistSongKey(song) === key).map(({ playlistId }) => playlistId),
  );
  const rewrites: number[] = [];
  const drops: number[] = [];
  for (const { itemId, playlistId } of holders) {
    if (holding.has(playlistId)) {
      drops.push(itemId);
      continue;
    }
    holding.add(playlistId);
    rewrites.push(itemId);
  }
  return { rewrites, drops };
};
