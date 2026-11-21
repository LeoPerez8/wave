/**
 * The playlists' side of Discover's Magic Queue pool (Core's `MagicQueuePool`).
 * Its ids come in one read, however many there are (#1351), and stay until
 * the playlists or the Library's files change, so returning to Home reads none.
 */
import * as Effect from "effect/Effect";

import { createSourceRead } from "../lib/sourceRead.ts";
import type { LibraryStore } from "../library/LibraryStore.ts";

/** The entries' video ids, each video once, in one read. */
export const readPlaylistSeedIds = (
  store: Pick<LibraryStore["Service"], "playlistEntryVideoIds">,
) => store.playlistEntryVideoIds;

export const createPlaylistSeedIdsRead = <A, E, R>(read: Effect.Effect<A, E, R>) =>
  createSourceRead(read, ["tracks", "playlists"]);
