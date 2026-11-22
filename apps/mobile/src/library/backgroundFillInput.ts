import { indexFillPlaylistsSteps } from "@wave/core";
import * as Effect from "effect/Effect";
import { runSteps } from "../lib/stepped.ts";
import type { LibraryStore } from "./LibraryStore.ts";

/**
 * Reads one playlist snapshot on a free turn ([turn]), then indexes it in background slices,
 * each after [between] (#1453): an import's thousands of unsearched songs never hold the thread
 * at startup.
 */
export const readBackgroundFillInput = (
  store: LibraryStore["Service"],
  turn: Effect.Effect<void>,
  between: Effect.Effect<void>,
) =>
  Effect.gen(function* () {
    yield* turn;
    const playlists = yield* store.unsearchedEntries;
    const lastPlayed = yield* store.playlistsLastPlayed;
    const entries = yield* runSteps(
      indexFillPlaylistsSteps(
        playlists.map(({ playlistId, songs }) => ({ id: playlistId, usedAt: null, songs })),
      ),
      between,
    );
    return { entries, lastPlayed };
  });
