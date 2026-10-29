import { en } from "./catalogueEn.ts";
/**
 * The Stats rankings and their "See all" lists: which rankings exist, and
 * reading a See all route back into a ranking and a period.
 */
import { STATS_PERIODS, type StatsPeriod } from "./stats.ts";

/** What a ranking ranks. */
export type StatsRanking = "songs" | "albums" | "artists";

/** The rankings the Stats screen shows, top to bottom. */
export const STATS_RANKINGS: readonly {
  readonly id: StatsRanking;
  readonly title: string;
}[] = (["songs", "albums", "artists"] as const).map((id) => ({
  id,
  title: en.stats.rankings[id],
}));

/** A See all list: one ranking over one period. */
export interface StatsSeeAll {
  readonly ranking: StatsRanking;
  readonly period: StatsPeriod;
}

type Param = string | readonly string[] | undefined;

const first = (param: Param): string | undefined =>
  typeof param === "string" ? param : param?.[0];

/**
 * Reads a See all route's `ranking` and `period` params (the first value of a
 * repeated one). Undefined when either is unknown.
 */
export const statsSeeAll = (ranking: Param, period: Param): StatsSeeAll | undefined => {
  const rankingId = first(ranking);
  const periodId = first(period);
  const foundRanking = STATS_RANKINGS.find((option) => option.id === rankingId);
  const foundPeriod = STATS_PERIODS.find((option) => option.id === periodId);
  return foundRanking === undefined || foundPeriod === undefined
    ? undefined
    : { ranking: foundRanking.id, period: foundPeriod.id };
};
