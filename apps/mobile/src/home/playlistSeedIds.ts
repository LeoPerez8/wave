/**
 * The playlists' side of Discover's Magic Queue pool (Core's `MagicQueuePool`).
 * A long list's ids come in pages with a turn between them, and stay until
 * the playlists or the Library's files change, so returning to Home reads none.
 */
import * as Effect from "effect/Effect";

import { createSourceRead } from "../lib/sourceRead.ts";
import type { LibraryStore } from "../library/LibraryStore.ts";

/** Every page of the entries' video ids, each video once, with [between] between pages. */
export const readPlaylistSeedIds = <E, R>(
  store: Pick<LibraryStore["Service"], "playlistEntryVideoIdsPage">,
  between: Effect.Effect<void, E, R>,
) =>
  Effect.gen(function* () {
    const videos = new Set<string>();
    let page = yield* store.playlistEntryVideoIdsPage(0);
    for (;;) {
      for (const video of page.videos) videos.add(video);
      if (page.next === null) return [...videos];
      yield* between;
      page = yield* store.playlistEntryVideoIdsPage(page.next);
    }
  });

export const createPlaylistSeedIdsRead = <A, E, R>(read: Effect.Effect<A, E, R>) =>
  createSourceRead(read, ["tracks", "playlists"]);
