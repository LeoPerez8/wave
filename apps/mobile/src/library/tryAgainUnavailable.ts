/**
 * Try Again on a playlist's "N unavailable" line (docs/spec.md, YT Music,
 * "Unavailable entries"): searches YouTube Music once more for the
 * playlist's unavailable entries, in the shared search allowance with
 * downloads' priority, and settles what it finds. Core decides which entries
 * are searched and what each answer settles (`tryAgainSearches`,
 * `tryAgainSettles`); a short notice says how it went (`tryAgainNotice`).
 */
import {
  tryAgainNotice,
  tryAgainSearches,
  type PlaylistItem,
  type TryAgainAnswered,
  type TryAgainSearch,
  type YtAlbumSong,
  type YtSongSearch,
} from "@wave/core";
import * as Result from "effect/Result";
import { useSyncExternalStore } from "react";

import { makeExternalStore } from "@/lib/externalStore";
import { showError } from "@/overlay/alert";
import { showToast } from "@/overlay/toast";
import { askYtMusic } from "@/ytmusic/askYtMusic";
import { logSearchFailure, searchTurn } from "@/ytmusic/searchAllowance";

import { LibraryStore } from "./LibraryStore";
import { playlistsChanged } from "./playlists";
import { appRuntime } from "./runtime";

/** Searches asked at once, as an import asks them. */
const AT_ONCE = 4;
/** Answers settled in one write, so a long run fills the playlist as it goes without redrawing per song. */
const SETTLE_EVERY = 25;

/** The playlists Try Again is searching for now. */
const running = makeExternalStore<ReadonlySet<number>>(new Set());

/** Whether Try Again is searching for [playlistId]'s unavailable entries now. */
export const useTryingAgain = (playlistId: number): boolean =>
  useSyncExternalStore(running.subscribe, () => running.get().has(playlistId));

/** One Songs search for [search]'s song, once Try Again's turn comes. Never rejects. */
const ask = async (search: TryAgainSearch): Promise<YtSongSearch<YtAlbumSong>> => {
  await searchTurn("tryAgain");
  let answer: YtSongSearch<YtAlbumSong>;
  try {
    const result = await askYtMusic((ytMusic) => ytMusic.searchSongs(search.query));
    answer = Result.isFailure(result)
      ? { ok: false, reason: result.failure.reason }
      : { ok: true, songs: result.success.songs };
  } catch {
    answer = { ok: false, reason: "failed" };
  }
  if (!answer.ok) logSearchFailure("tryAgain", search.query, answer.reason);
  return answer;
};

/** Writes what [answered] found into [playlistId]; returns how many were found and failed. */
const settle = async (
  playlistId: number,
  answered: readonly TryAgainAnswered<YtAlbumSong>[],
): Promise<{ readonly found: number; readonly failed: number }> => {
  // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
  const settled = LibraryStore.use((store) => store.settleTryAgain(playlistId, answered));
  try {
    return await appRuntime.runPromise(settled);
  } finally {
    playlistsChanged([playlistId]);
  }
};

/**
 * Searches again for [entries]' unavailable songs (the playlist
 * [playlistId]'s, as its page lists them), at most `AT_ONCE` at a time, and
 * settles each batch as it answers. Does nothing while a Try Again for the
 * playlist is going on. Once it ends, a notice says how many were found.
 */
export const tryAgainUnavailable = (
  playlistId: number,
  entries: readonly (PlaylistItem<YtAlbumSong> & { readonly itemId: number })[],
): void => {
  const searches = tryAgainSearches(entries);
  if (searches.length === 0 || running.get().has(playlistId)) return;
  running.update((ids) => new Set([...ids, playlistId]));
  void (async () => {
    let found = 0;
    let failed = 0;
    try {
      for (let start = 0; start < searches.length; start += SETTLE_EVERY) {
        const batch = searches.slice(start, start + SETTLE_EVERY);
        // Kept in playlist order, whichever answers first: of two found as one song, the earlier stays.
        const answers: (YtSongSearch<YtAlbumSong> | undefined)[] = [];
        let next = 0;
        const worker = async (): Promise<void> => {
          while (next < batch.length) {
            const at = next;
            next += 1;
            const search = batch[at];
            if (search !== undefined) answers[at] = await ask(search);
          }
        };
        await Promise.all(Array.from({ length: Math.min(AT_ONCE, batch.length) }, worker));
        const answered = batch.flatMap((search, at) => {
          const answer = answers[at];
          return answer === undefined ? [] : [{ search, answer }];
        });
        const settled = await settle(playlistId, answered);
        found += settled.found;
        failed += settled.failed;
      }
      void showToast(tryAgainNotice({ searched: searches.length, found, failed }));
    } catch (error) {
      void showError("Couldn't save what Try Again found", error);
    } finally {
      running.update((ids) => new Set([...ids].filter((id) => id !== playlistId)));
    }
  })();
};
