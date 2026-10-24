import { randomMagicQueuePicks, type LibraryReads, type RandomSource } from "@wave/core";
import * as Effect from "effect/Effect";
import type { LibraryStore } from "../library/LibraryStore.ts";

let nextRead = 0;

/** A fresh Home opening reads ids only, then metadata for its nine random seeds. */
export const randomMagicQueueRead = (random: RandomSource, previous?: readonly number[]) => {
  let ids = previous;
  return {
    key: `randomMagicQueue:${++nextRead}`,
    reads: { tracks: true, favorites: true } satisfies LibraryReads,
    read: (store: LibraryStore["Service"]) =>
      Effect.gen(function* () {
        ids = randomMagicQueuePicks(yield* store.playableSongIds, random, ids);
        const songs = yield* store.songsByIds(ids);
        const byId = new Map(songs.map((song) => [song.id, song]));
        return ids.flatMap((id) => byId.get(id) ?? []);
      }),
  };
};
