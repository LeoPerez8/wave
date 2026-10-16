import {
  albumPlayTotals,
  artistStats,
  artistPlayTotals,
  rankPlays,
  statsWindow,
  type ArtistStats as ArtistStatsLines,
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

/** An artist page's stats block, its most played songs loaded. */
export type ArtistStats =
  | Extract<ArtistStatsLines, { played: false }>
  | (Omit<Extract<ArtistStatsLines, { played: true }>, "mostPlayed"> & {
      readonly mostPlayed: readonly Ranked<SongRow>[];
    });

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
    /**
     * The artist page's stats block over all time, over the songs whose credit
     * names the artist (a collaboration counts for each of its artists).
     */
    readonly artist: (artistId: number) => Effect.Effect<ArtistStats, LibraryStoreError>;
  }
>()("@wave/mobile/stats/Stats") {}

/**
 * Loads the rows of a ranking's entities, in ranking order. An entity that
 * left the library since the totals were read is skipped.
 */
const withRows = <A extends { readonly id: number }>(
  ranking: readonly PlayTotals[],
  rows: (ids: readonly number[]) => Effect.Effect<readonly A[], LibraryStoreError>,
): Effect.Effect<readonly Ranked<A>[], LibraryStoreError> => {
  if (ranking.length === 0) return Effect.succeed([]);
  return Effect.map(rows(ranking.map((entry) => entry.id)), (found) => {
    const byId = new Map(found.map((row) => [row.id, row]));
    return ranking.flatMap((entry) => {
      const item = byId.get(entry.id);
      return item === undefined ? [] : [{ item, countedPlays: entry.countedPlays }];
    });
  });
};

/** Ranks the store's totals with Core's rule, then loads the rows of the winners. */
const rank = <A extends { readonly id: number }>(
  totals: readonly PlayTotals[],
  limit: number,
  rows: (ids: readonly number[]) => Effect.Effect<readonly A[], LibraryStoreError>,
): Effect.Effect<readonly Ranked<A>[], LibraryStoreError> =>
  withRows(rankPlays(totals, limit), rows);

/** The albums and the artists played most in a period, ranked from one read. */
export interface TopAlbumsAndArtists {
  readonly albums: readonly Ranked<AlbumRow>[];
  readonly artists: readonly Ranked<ArtistRow>[];
}

/**
 * The top [albumLimit] albums and [artistLimit] artists of `period`, as
 * Stats' `topAlbums` and `topArtists` rank them, from one read of the
 * credited totals: Home's Most played albums and artists, which show together.
 */
export const topAlbumsAndArtists = (
  store: LibraryStore["Service"],
  period: StatsPeriod,
  albumLimit: number,
  artistLimit: number,
): Effect.Effect<TopAlbumsAndArtists, LibraryStoreError> =>
  Effect.flatMap(
    Effect.suspend(() => store.creditedPlayTotals(statsWindow(period, Date.now()))),
    (credits) =>
      Effect.all({
        albums: rank(albumPlayTotals(credits), albumLimit, store.albumsByIds),
        artists: rank(artistPlayTotals(credits), artistLimit, store.artistsByIds),
      }),
  );

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
      artist: (artistId) => {
        const now = Date.now();
        return Effect.flatMap(
          store.artistPlays(artistId, now),
          (plays): Effect.Effect<ArtistStats, LibraryStoreError> => {
            const stats = artistStats({ artistId, now, ...plays });
            if (!stats.played) return Effect.succeed(stats);
            return Effect.map(withRows(stats.mostPlayed, store.songsByIds), (mostPlayed) => ({
              ...stats,
              mostPlayed,
            }));
          },
        );
      },
    };
  }),
);
