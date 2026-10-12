import {
  albumPlayTotals,
  artistPlayTotals,
  rankPlays,
  statsWindow,
  type PlayTotals,
  type StatsPeriod,
} from "@wave/core";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  LibraryStore,
  type AlbumRow,
  type ArtistRow,
  type LibraryStoreError,
  type SongRow,
} from "@/library/LibraryStore";

/** A ranked entity with its counted plays in the period. */
export interface Ranked<A> {
  readonly item: A;
  readonly countedPlays: number;
}

export class Stats extends Context.Service<
  Stats,
  {
    /** The `limit` songs played most in `period` (rolling, ending now), the top one first. */
    readonly topSongs: (
      period: StatsPeriod,
      limit: number,
    ) => Effect.Effect<readonly Ranked<SongRow>[], LibraryStoreError>;
    /** The `limit` albums played most in `period` (title + album artist, as in the Library). */
    readonly topAlbums: (
      period: StatsPeriod,
      limit: number,
    ) => Effect.Effect<readonly Ranked<AlbumRow>[], LibraryStoreError>;
    /** The `limit` artists played most in `period`, credited by track artist. */
    readonly topArtists: (
      period: StatsPeriod,
      limit: number,
    ) => Effect.Effect<readonly Ranked<ArtistRow>[], LibraryStoreError>;
  }
>()("@wave/mobile/stats/Stats") {}

/**
 * Ranks the store's totals with Core's rule, then loads the rows of the
 * winners, in ranking order. An entity that left the library between the two
 * reads is skipped.
 */
const rank = <A extends { readonly id: number }>(
  totals: readonly PlayTotals[],
  limit: number,
  rows: (ids: readonly number[]) => Effect.Effect<readonly A[], LibraryStoreError>,
): Effect.Effect<readonly Ranked<A>[], LibraryStoreError> => {
  const ranking = rankPlays(totals, limit);
  if (ranking.length === 0) return Effect.succeed([]);
  return Effect.map(rows(ranking.map((entry) => entry.id)), (found) => {
    const byId = new Map(found.map((row) => [row.id, row]));
    return ranking.flatMap((entry) => {
      const item = byId.get(entry.id);
      return item === undefined ? [] : [{ item, countedPlays: entry.countedPlays }];
    });
  });
};

export const layer = Layer.effect(
  Stats,
  Effect.gen(function* () {
    const store = yield* LibraryStore;
    return {
      topSongs: (period, limit) =>
        Effect.flatMap(store.trackPlayTotals(statsWindow(period, Date.now())), (totals) =>
          rank(totals, limit, store.songsByIds),
        ),
      topAlbums: (period, limit) =>
        Effect.flatMap(store.creditedPlayTotals(statsWindow(period, Date.now())), (credits) =>
          rank(albumPlayTotals(credits), limit, store.albumsByIds),
        ),
      topArtists: (period, limit) =>
        Effect.flatMap(store.creditedPlayTotals(statsWindow(period, Date.now())), (credits) =>
          rank(artistPlayTotals(credits), limit, store.artistsByIds),
        ),
    };
  }),
);
