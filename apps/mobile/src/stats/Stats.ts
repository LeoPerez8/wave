import type { PlayedAlbum, PlayedArtist } from "@/library/db/playedEntities";
import {
  statsWindow,
  type ArtistStats as ArtistStatsLines,
  type GenreFamily,
  type MixedSong,
  type RecapPeriod,
  type RecapSlide,
  type StatsPeriod,
  type YtAlbumSong,
} from "@wave/core";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

import { lazyService } from "@/lib/lazyService";
import type { RecapHistoryVersion } from "./recapAvailability";

import type { LibraryStore, LibraryStoreError, SongRow } from "@/library/LibraryStore";

import { make } from "./statsLive";

/** A ranked entity with its counted plays in the period. */
export interface Ranked<A> {
  readonly item: A;
  readonly countedPlays: number;
}

/** A song in Stats' song ranking: a Library song, or a streamed one the Library hasn't. */
export type StatsSong = MixedSong<YtAlbumSong, SongRow>;

/** An artist page's stats block, its most played songs loaded. */
export type ArtistStats =
  | Extract<ArtistStatsLines, { played: false }>
  | (Omit<Extract<ArtistStatsLines, { played: true }>, "mostPlayed"> & {
      readonly mostPlayed: readonly Ranked<StatsSong>[];
    });

/** A Recap slide with the rows it shows loaded. */
export type LoadedRecapSlide =
  | Exclude<RecapSlide, { kind: "topSongs" | "topArtists" | "topAlbum" | "discovered" | "summary" }>
  | { readonly kind: "topSongs"; readonly songs: readonly Ranked<StatsSong>[] }
  | { readonly kind: "topArtists"; readonly artists: readonly Ranked<PlayedArtist>[] }
  | { readonly kind: "topAlbum"; readonly album: Ranked<PlayedAlbum> }
  | {
      readonly kind: "discovered";
      /** How many artists the period discovered. */
      readonly count: number;
      /** The most played of them, the top one first. */
      readonly artists: readonly Ranked<PlayedArtist>[];
    }
  | {
      /** The summary card: the top songs (Library and streamed) and artists. */
      readonly kind: "summary";
      readonly minutes: number;
      readonly songs: readonly Ranked<StatsSong>[];
      readonly artists: readonly Ranked<PlayedArtist>[];
      readonly genre: GenreFamily | null;
    };

/** A Recap as its stories show it: Core's slides, their songs loaded. */
export interface LoadedRecap {
  readonly period: RecapPeriod;
  readonly title: string;
  readonly slides: readonly LoadedRecapSlide[];
}

export class Stats extends Context.Service<
  Stats,
  {
    /**
     * The `limit` songs played most in `period` (rolling, ending now), the top
     * one first, streamed songs included.
     */
    readonly topSongs: (
      period: StatsPeriod,
      limit: number,
    ) => Effect.Effect<readonly Ranked<StatsSong>[], LibraryStoreError>;
    /** The `limit` albums played most in `period` (title + album artist, as in the Library). */
    readonly topAlbums: (
      period: StatsPeriod,
      limit: number,
    ) => Effect.Effect<readonly Ranked<PlayedAlbum>[], LibraryStoreError>;
    /** The `limit` artists played most in `period`, credited by track artist. */
    readonly topArtists: (
      period: StatsPeriod,
      limit: number,
    ) => Effect.Effect<readonly Ranked<PlayedArtist>[], LibraryStoreError>;
    /**
     * The artist page's stats block over all time, over the songs whose credit
     * names the artist (a collaboration counts for each of its artists).
     */
    readonly artist: (artistId: number) => Effect.Effect<ArtistStats, LibraryStoreError>;
    /** Every period with a Recap now, newest first (Core's `availableRecaps`). */
    readonly recaps: (
      now: number,
      between: Effect.Effect<void>,
    ) => Effect.Effect<readonly RecapPeriod[], LibraryStoreError>;
    readonly recapHistoryVersion: RecapHistoryVersion;
    /** `period`'s Recap, its slides' rows loaded; null when the period has no Recap now. */
    readonly recap: (period: RecapPeriod) => Effect.Effect<LoadedRecap | null, LibraryStoreError>;
  }
>()("@wave/mobile/stats/Stats") {}

/** The albums and the artists played most in a period, ranked from one read. */
export interface TopAlbumsAndArtists {
  readonly albums: readonly Ranked<PlayedAlbum>[];
  readonly artists: readonly Ranked<PlayedArtist>[];
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
  Effect.map(
    Effect.suspend(() => store.playedEntityTotals(statsWindow(period, Date.now()))),
    (totals) => ({
      albums: totals.albums.slice(0, albumLimit),
      artists: totals.artists.slice(0, artistLimit),
    }),
  );

/** Built on first use (`lazyService`): the launch never reads Stats. */
export const layer = lazyService(Stats, () => make);
