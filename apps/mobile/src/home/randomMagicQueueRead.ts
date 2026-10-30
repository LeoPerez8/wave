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
 * YT Music entries), then metadata for its nine random seeds.
 */
export const randomMagicQueueRead = (
  random: RandomSource,
  previous?: readonly MagicQueueSeedId[],
) => {
  let ids = previous;
  return {
    key: `randomMagicQueue:${++nextRead}`,
    reads: { tracks: true, favorites: true, playlists: true } satisfies LibraryReads,
    read: (store: LibraryStore["Service"]) =>
      Effect.gen(function* () {
        const trackIds = yield* store.playableSongIds;
        const videoIds = yield* store.playlistEntryVideoIds;
        ids = randomMagicQueuePicks({ trackIds, videoIds }, random, ids);
        const picked = ids;
        const files = yield* store.songsByIds(
          picked.filter((id): id is number => typeof id === "number"),
        );
        const pickedVideos = picked.filter((id): id is string => typeof id === "string");
        const entries =
          pickedVideos.length === 0 ? [] : yield* store.playlistEntrySongs(pickedVideos);
        const seeds = new Map<MagicQueueSeedId, MagicQueueSeed<PlayableSongRow>>([
          ...files.map((song) => [song.id, { source: "library", song }] as const),
          ...entries.map((song) => [song.videoId, { source: "stream", song }] as const),
        ]);
        return picked.flatMap((id) => seeds.get(id) ?? []);
      }),
  };
};
