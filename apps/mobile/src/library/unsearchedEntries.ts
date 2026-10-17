/**
 * Settling unsearched entries (docs/spec.md, YT Music, "Unavailable
 * entries"): the songs a Spotify import listed that nothing has searched on
 * YouTube Music yet. One YouTube Music Songs search for a song's title and
 * artists, in the shared search allowance with its asker's priority; Core
 * decides what the answer settles (`settleUnsearched`), and the store
 * writes it into every playlist holding the song (`settleUnsearched`, Core's
 * `unsearchedSettles`). Playing asks it (`playingSearches`), and so can the
 * background fill and downloads: what they all settle, they settle alike.
 */
import {
  settleUnsearched,
  unsearchedSearchQuery,
  type SearchAsker,
  type UnsearchedSettlement,
  type UnsearchedSong,
  type YtAlbumSong,
  type YtSongSearch,
} from "@wave/core";
import * as Result from "effect/Result";

import { askYtMusic } from "@/ytmusic/askYtMusic";
import { logSearchFailure, searchTurn } from "@/ytmusic/searchAllowance";

import { LibraryStore } from "./LibraryStore";
import { playlistsChanged } from "./playlists";
import { appRuntime } from "./runtime";

/** One YouTube Music Songs search for [query]; a failure is an answer too. Never rejects. */
const searchSongs = async (query: string): Promise<YtSongSearch<YtAlbumSong>> => {
  try {
    const result = await askYtMusic((ytMusic) => ytMusic.searchSongs(query));
    return Result.isFailure(result)
      ? { ok: false, reason: result.failure.reason }
      : { ok: true, songs: result.success.songs };
  } catch {
    return { ok: false, reason: "failed" };
  }
};

/**
 * Settles [song] by [answer], a Songs search for it (`unsearchedSearchQuery`)
 * asked by anyone: found, it becomes the YT Music song, and not found, an
 * unavailable entry, in every playlist that holds it; a failed search leaves
 * it unsearched. Resolves to what it settled; rejects only when the
 * playlists can't be written.
 */
export const settleUnsearchedSong = async (
  song: UnsearchedSong,
  answer: YtSongSearch<YtAlbumSong>,
): Promise<UnsearchedSettlement<YtAlbumSong>> => {
  const settlement = settleUnsearched(song, answer);
  if (settlement.kind === "failed") return settlement;
  // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
  const write = LibraryStore.use((store) => store.settleUnsearched(song, settlement.becomes));
  const { playlistIds } = await appRuntime.runPromise(write);
  if (playlistIds.length > 0) playlistsChanged(playlistIds);
  return settlement;
};

/**
 * Searches YouTube Music for [song] once [asker]'s turn in the shared search
 * allowance comes, then settles it (`settleUnsearchedSong`). A failed search
 * is logged and settles nothing. Null when [signal] gave the turn up first.
 * Rejects only when the playlists can't be written.
 */
export const searchUnsearchedSong = async (
  song: UnsearchedSong,
  asker: SearchAsker,
  signal?: AbortSignal,
): Promise<UnsearchedSettlement<YtAlbumSong> | null> => {
  if (!(await searchTurn(asker, signal))) return null;
  const query = unsearchedSearchQuery(song);
  const answer = await searchSongs(query);
  if (!answer.ok) logSearchFailure(asker, query, answer.reason);
  return settleUnsearchedSong(song, answer);
};
