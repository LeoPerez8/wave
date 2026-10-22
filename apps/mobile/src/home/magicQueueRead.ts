import { libraryTrackIds, MAGIC_QUEUE_PICKS, type LibraryReads } from "@wave/core";
import * as Effect from "effect/Effect";
import type { LibraryStore } from "../library/LibraryStore.ts";

/** The row reads its saved songs only. Restoring saved order never depends on SQLite's order. */
export const magicQueueRead = (trackIds: readonly string[]) => {
  const ordered = trackIds.slice(0, MAGIC_QUEUE_PICKS);
  const ids = libraryTrackIds(ordered);
  return {
    key: `magicQueueSection:${JSON.stringify(ordered)}`,
    reads: { tracks: ids, favorites: ids } satisfies LibraryReads,
    read: (store: LibraryStore["Service"]) =>
      store.songsByIds(ids).pipe(
        Effect.map((songs) => {
          const byId = new Map(songs.map((song) => [String(song.id), song]));
          return ordered.flatMap((id) => byId.get(id) ?? []);
        }),
      ),
  };
};

/** Only short lists watch growth. A full nine-song row has no whole-track subscription. */
export const magicQueueGrowthRead = (trackIds: readonly string[]) => ({
  key: `magicQueueGrowth:${JSON.stringify(trackIds)}`,
  reads: { tracks: true } satisfies LibraryReads,
  read: (store: LibraryStore["Service"]) => store.hasPlayableSongOutside(libraryTrackIds(trackIds)),
});
