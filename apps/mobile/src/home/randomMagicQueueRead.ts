import {
  randomMagicQueuePicks,
  type LibraryReads,
  type MagicQueueSeed,
  type MagicQueueSeedId,
  type RandomSource,
} from "@wave/core";
import * as Effect from "effect/Effect";
import type { LibraryStore, PlayableSongRow } from "../library/LibraryStore.ts";

let nextRead = 0;

/**
 * A fresh Home opening reads ids only (the Library's files and the playlists'
 * YT Music entries), then metadata for its nine random seeds. A video whose
 * stored song can't be read leaves the pool for the visit, and its place is
 * drawn again.
 */
export const randomMagicQueueRead = (
  random: RandomSource,
  previous?: readonly MagicQueueSeedId[],
) => {
  let ids = previous;
  const unreadable = new Set<string>();
  return {
    key: `randomMagicQueue:${++nextRead}`,
    reads: { tracks: true, favorites: true, playlists: true } satisfies LibraryReads,
    read: (store: LibraryStore["Service"]) =>
      Effect.gen(function* () {
        const trackIds = yield* store.playableSongIds;
        const videoIds = yield* store.playlistEntryVideoIds;
        for (;;) {
          const pool = { trackIds, videoIds: videoIds.filter((id) => !unreadable.has(id)) };
          const picked = randomMagicQueuePicks(pool, random, ids);
          ids = picked;
          const files = yield* store.songsByIds(
            picked.filter((id): id is number => typeof id === "number"),
          );
          const pickedVideos = picked.filter((id): id is string => typeof id === "string");
          const entries =
            pickedVideos.length === 0 ? [] : yield* store.playlistEntrySongs(pickedVideos);
          const seeds = new Map<MagicQueueSeedId, MagicQueueSeed<PlayableSongRow>>();
          for (const song of files) seeds.set(song.id, { source: "library", song });
          for (const song of entries) seeds.set(song.videoId, { source: "stream", song });
          const lost = pickedVideos.filter((id) => !seeds.has(id));
          if (lost.length === 0) return picked.flatMap((id) => seeds.get(id) ?? []);
          for (const id of lost) unreadable.add(id);
        }
      }),
  };
};
