import type { PlaylistRow } from "@wave/client";
import { fromYourLibrary } from "@wave/core";
import * as Effect from "effect/Effect";

import { libraryQuery, useLibraryQuery } from "@/library/hooks";
import { LibraryStore } from "@/library/LibraryStore";

const readFromYourLibrary = libraryQuery(
  "home:fromYourLibrary",
  { playlists: true, tracks: true, plays: true },
  Effect.gen(function* () {
    const store = yield* LibraryStore;
    const plays = yield* store.playlistPlays(Date.now());
    // Nothing played from a playlist: the section is left out without listing them.
    if (plays.length === 0) return [] as readonly PlaylistRow[];
    return fromYourLibrary(yield* store.listPlaylists, plays);
  }),
);

/**
 * Home's From your library: the owner's playlists, those played in the last
 * 14 days first and the rest by their plays of all time (Core's
 * `fromYourLibrary`), or undefined while it first loads. Re-read after plays
 * and playlist edits, as `useMostPlayedOfAllTime` is.
 */
export const useFromYourLibrary = (): readonly PlaylistRow[] | undefined =>
  useLibraryQuery<readonly PlaylistRow[] | undefined>(readFromYourLibrary, undefined);
