import type { PlayedAlbum, PlayedArtist } from "@wave/client/db/playedEntities";
import {
  type ArtistStats as ArtistStatsLines,
  type Catalogue,
  type RecapGenre,
  type RecapPeriod,
  type StatsPeriod,
} from "@wave/core";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

import { lazyService } from "@/lib/lazyService";
import type { Turn } from "@/lib/stepped";
import type { RecapHistoryVersion } from "./recapAvailability";

import type { LibraryStoreError } from "@/library/LibraryStore";
import type { LoadedRecap } from "@wave/client/db/recapStories";
import type { Ranked, StatsSong } from "@wave/client/db/statsQueries";

import { make } from "./statsLive";

export type { Ranked, StatsSong } from "@wave/client/db/statsQueries";
export type { LoadedRecap, LoadedRecapSlide } from "@wave/client/db/recapStories";
export { topAlbumsAndArtists } from "@wave/client/db/statsQueries";

/** An artist page's stats block, its most played songs loaded. */
export type ArtistStats =
  | Extract<ArtistStatsLines, { played: false }>
  | (Omit<Extract<ArtistStatsLines, { played: true }>, "mostPlayed"> & {
      readonly mostPlayed: readonly Ranked<StatsSong>[];
    });

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
    /** Top five genre families over known-genre counted plays in this period. */
    readonly topGenres: (
      period: StatsPeriod,
    ) => Effect.Effect<readonly RecapGenre[], LibraryStoreError>;
    /**
     * The artist page's stats block over all time, over the songs whose credit
     * names the artist (a collaboration counts for each of its artists),
     * worded in [strings]' language.
     */
    readonly artist: (
      artistId: number,
      strings: Catalogue,
    ) => Effect.Effect<ArtistStats, LibraryStoreError>;
    /** Every period with a Recap now, newest first (Core's `availableRecaps`). */
    readonly recaps: (
      now: number,
      between: Turn,
    ) => Effect.Effect<readonly RecapPeriod[], LibraryStoreError>;
    readonly recapHistoryVersion: RecapHistoryVersion;
    /** `period`'s Recap, its slides' rows loaded; null when the period has no Recap now. */
    readonly recap: (period: RecapPeriod) => Effect.Effect<LoadedRecap | null, LibraryStoreError>;
  }
>()("@wave/mobile/stats/Stats") {}

/** Built on first use (`lazyService`): the launch never reads Stats. */
export const layer = lazyService(Stats, () => make);
