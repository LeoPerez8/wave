import type { RecapGenre, RecapHabits, RecapPeriod, StatsPeriod, StatsRanking } from "@wave/core";
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

/** One story of a Recap as the window shows it: Core's slide, its rows loaded by main. */
export type RecapStory =
  | { readonly kind: "minutes"; readonly minutes: number }
  | { readonly kind: "topSongs"; readonly songs: readonly StatsRow[] }
  | { readonly kind: "topArtists"; readonly artists: readonly StatsRow[] }
  | { readonly kind: "topAlbum"; readonly album: StatsRow }
  | { readonly kind: "topGenres"; readonly genres: readonly RecapGenre[] }
  | ({ readonly kind: "habits" } & RecapHabits)
  | {
      readonly kind: "discovered";
      /** How many artists the period discovered; [artists] names the most played of them. */
      readonly count: number;
      readonly artists: readonly StatsRow[];
    }
  | {
      readonly kind: "summary";
      readonly minutes: number;
      readonly songs: readonly StatsRow[];
      readonly artists: readonly StatsRow[];
      /** The top genre family's name; null with no song with a genre. */
      readonly genre: string | null;
    };

/** A Recap as its stories show it. */
export interface DesktopRecap {
  readonly period: RecapPeriod;
  readonly slides: readonly RecapStory[];
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
