import {
  followSuggestionsWindow,
  lightListener,
  type FollowSuggestionPlays,
  type KeptSongs,
} from "@wave/core";
import * as Effect from "effect/Effect";

import type { PlayedArtist, PlayedEntityTotal } from "./db/playedEntities";
import { libraryQuery, useLibraryQuery } from "./sharedQueries";
import { LibraryStore } from "./LibraryStore";

/**
 * What Core's `followSuggestions` ranks: the played artists, the last 90
 * days' and all time's, and for a light listener what they keep.
 */
export interface FollowSuggestionPlayed {
  readonly recent: readonly FollowSuggestionPlays<PlayedArtist>[];
  readonly allTime: readonly FollowSuggestionPlays<PlayedArtist>[];
  readonly kept?: KeptSongs<PlayedArtist>;
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
  { tracks: true, plays: true, playlists: true, favorites: true },
  // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
  LibraryStore.use((store) =>
    Effect.suspend(() => {
      const now = Date.now();
      return Effect.all({
        recent: store.playedArtistTotals(followSuggestionsWindow(now)),
        allTime: store.playedArtistTotals({ from: null, to: now }),
      });
    }).pipe(
      Effect.flatMap(({ recent, allTime }) => {
        const counted = { recent: played(recent), allTime: played(allTime) };
        // Only a light listener's suggestions read what they keep.
        return lightListener(counted.allTime)
          ? Effect.map(store.keptArtistSongs, (kept) => ({ ...counted, kept }))
          : Effect.succeed(counted);
      }),
    ),
  ),
);

/**
 * Each played artist's counted plays as Stats counts them (streamed plays
 * included, a collaboration counting for each artist it names), over the last
 * 90 days and all time, and for a light listener the songs they keep;
 * undefined until first read, or while [enabled] is false.
 */
export const useFollowSuggestionPlayed = (enabled: boolean): FollowSuggestionPlayed | undefined =>
  useLibraryQuery<FollowSuggestionPlayed | undefined>(enabled ? readPlayed : null, undefined);
