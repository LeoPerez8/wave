import type { RecapGenre, StatsPeriod, StatsRanking } from "@wave/core";
import type { BrowseRow } from "./browse.ts";

export interface StatsRow extends BrowseRow {
  /** Identifies the ranked entry even when it has no Library id. */
  readonly key: string;
  readonly countedPlays: number;
}

export interface StatsOverview {
  readonly songs: readonly StatsRow[];
  readonly albums: readonly StatsRow[];
  readonly artists: readonly StatsRow[];
  readonly genres: readonly RecapGenre[];
  readonly hasPlays: boolean;
}

/** All-time listening on an artist page, with its most played songs ready for the table. */
export type ArtistStatsPage =
  | { readonly played: false }
  | {
      readonly played: true;
      readonly plays: string;
      readonly minutesListened: string;
      readonly songsListened: string;
      readonly lastPlayed: string;
      readonly mostPlayed: readonly StatsRow[];
    };

export interface StatsRoute {
  readonly kind: "stats";
  readonly period: StatsPeriod;
  readonly ranking?: StatsRanking;
}
