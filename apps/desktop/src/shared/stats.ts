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

export interface StatsRoute {
  readonly kind: "stats";
  readonly period: StatsPeriod;
  readonly ranking?: StatsRanking;
}
