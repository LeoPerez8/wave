import {
  movePlaylist,
  parsePlaylistOrder,
  sortPlaylists,
  storedPlaylistOrder,
  type PlaylistOrder,
} from "@wave/core";
import * as Effect from "effect/Effect";

import { persistedSetting } from "@/lib/persistedSetting";

import type { LibraryStore, LibraryStoreError, PlaylistRow } from "./LibraryStore";

const sameOrder = (a: PlaylistOrder, b: PlaylistOrder): boolean =>
  a.sort === b.sort &&
  a.order.length === b.order.length &&
  a.order.every((id, index) => id === b.order[index]);

/**
 * The Playlists list's order (Core's `playlistSort.ts`): the sort, and the
 * owner's own order for Custom. Kept on this phone; it doesn't sync. Free of
 * screens and queries, so Android Auto's service reads it too.
 */
export const playlistOrder = persistedSetting<PlaylistOrder>({
  key: "settings.playlistOrder",
  read: parsePlaylistOrder,
  write: storedPlaylistOrder,
  equals: sameOrder,
});

/** No playlist played yet, or Recently Played not asked for. */
export const NEVER_PLAYED: ReadonlyMap<number, number> = new Map();

/** Every playlist in the order the owner picked, read now (Android Auto's Playlists). */
export const sortedPlaylists = (
  store: LibraryStore["Service"],
): Effect.Effect<readonly PlaylistRow[], LibraryStoreError> =>
  Effect.gen(function* () {
    const playlists = yield* store.listPlaylists;
    const { sort, order } = playlistOrder.get();
    const lastPlayed = sort === "played" ? yield* store.playlistsLastPlayed : NEVER_PLAYED;
    return sortPlaylists(playlists, { sort, order, lastPlayed });
  });

/**
 * Moves the playlist at [from] of [shown] (the ids in the order on screen) to
 * [to], switching the list to Custom from that order. False when it moves nothing.
 */
export const moveShownPlaylist = (shown: readonly number[], from: number, to: number): boolean => {
  const moved = movePlaylist(shown, from, to);
  if (moved === null) return false;
  playlistOrder.set(moved);
  return true;
};
