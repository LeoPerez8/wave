import { indexFillPlaylists } from "@wave/core";
import * as Effect from "effect/Effect";
import type { LibraryStore } from "./LibraryStore.ts";

/** Read and index one playlist snapshot on a free turn. */
export const readBackgroundFillInput = (
  store: LibraryStore["Service"],
  turn: Effect.Effect<void>,
) =>
  Effect.gen(function* () {
    yield* turn;
    const playlists = yield* store.unsearchedEntries;
    const lastPlayed = yield* store.playlistsLastPlayed;
    return {
      entries: indexFillPlaylists(
        playlists.map(({ playlistId, songs }) => ({ id: playlistId, usedAt: null, songs })),
      ),
      lastPlayed,
    };
  });
