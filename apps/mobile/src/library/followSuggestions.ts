import { followSuggestionsWindow, type FollowSuggestionPlays } from "@wave/core";
import * as Effect from "effect/Effect";

import type { PlayedArtist, PlayedEntityTotal } from "./db/playedEntities";
import { libraryQuery, useLibraryQuery } from "./sharedQueries";
import { LibraryStore } from "./LibraryStore";

/** The played artists Core's `followSuggestions` ranks: the last 90 days' and all time's. */
export interface FollowSuggestionPlayed {
  readonly recent: readonly FollowSuggestionPlays<PlayedArtist>[];
  readonly allTime: readonly FollowSuggestionPlays<PlayedArtist>[];
}

const played = (
  artists: readonly PlayedEntityTotal<PlayedArtist>[],
): FollowSuggestionPlays<PlayedArtist>[] =>
  artists.map((artist) => ({
    name: artist.item.name,
    countedPlays: artist.countedPlays,
    item: artist.item,
  }));

const readPlayed = libraryQuery(
  "settings:followSuggestions",
  { tracks: true, plays: true },
  // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
  LibraryStore.use((store) =>
    Effect.suspend(() => {
      const now = Date.now();
      return Effect.all({
        recent: store.playedEntityTotals(followSuggestionsWindow(now)),
        allTime: store.playedEntityTotals({ from: null, to: now }),
      });
    }).pipe(
      Effect.map(({ recent, allTime }) => ({
        recent: played(recent.artists),
        allTime: played(allTime.artists),
      })),
    ),
  ),
);

/**
 * Each played artist's counted plays as Stats counts them (streamed plays
 * included, a collaboration counting for each artist it names), over the last
 * 90 days and all time; undefined until first read, or while [enabled] is false.
 */
export const useFollowSuggestionPlayed = (enabled: boolean): FollowSuggestionPlayed | undefined =>
  useLibraryQuery<FollowSuggestionPlayed | undefined>(enabled ? readPlayed : null, undefined);
