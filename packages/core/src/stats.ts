/**
 * Listening stats: rankings of the songs (and later albums and artists) played
 * most over a stats period, a rolling window ending now. Only counted plays
 * (see `isCountedPlay`) enter a ranking.
 */

/** A stats period: a rolling window ending now. */
export type StatsPeriod = "week" | "month" | "year" | "all";

/** The periods the Stats screen offers, from the shortest to all time. */
export const STATS_PERIODS: readonly {
  readonly id: StatsPeriod;
  readonly label: string;
  /** The label on the period selector's tab, where four must fit across. */
  readonly tab: string;
}[] = [
  { id: "week", label: "Last 7 days", tab: "7 days" },
  { id: "month", label: "Last 30 days", tab: "30 days" },
  { id: "year", label: "Last 12 months", tab: "12 months" },
  { id: "all", label: "All time", tab: "All time" },
];

/** The plays a period covers: started at or after `from` (no start for all time) and at or before `to`. */
export interface StatsWindow {
  readonly from: number | null;
  readonly to: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The same moment a year before `now` (UTC); from a leap day, the last day of February. */
const yearBefore = (now: number): number => {
  const date = new Date(now);
  const month = date.getUTCMonth();
  date.setUTCFullYear(date.getUTCFullYear() - 1);
  // 29 February rolled over into March: step back to the last day of February.
  if (date.getUTCMonth() !== month) date.setUTCDate(0);
  return date.getTime();
};

/** How many entries a ranking shows on the Stats screen. */
export const STATS_TOP = 10;
/** How many entries a ranking's See all shows. */
export const STATS_SEE_ALL = 100;

/**
 * What the library sums up for one entity (a song, an album, an artist) over
 * a stats window, counting only counted plays.
 */
export interface PlayTotals {
  readonly id: number;
  /** The entity's sort key (title or name), the last tie-break before the id. */
  readonly sortKey: string;
  readonly countedPlays: number;
  /** Time listened over its counted plays. */
  readonly listenedMs: number;
  /** When its latest counted play started. */
  readonly latestPlayAt: number;
}

const compareRanked = (a: PlayTotals, b: PlayTotals): number =>
  b.countedPlays - a.countedPlays ||
  b.listenedMs - a.listenedMs ||
  b.latestPlayAt - a.latestPlayAt ||
  (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0) ||
  a.id - b.id;

/**
 * The top `limit` entities: most counted plays first, then most listened time,
 * then the most recent play, then by sort key and id, so the order never
 * depends on how the totals arrived. Entities without a counted play are left out.
 */
export const rankPlays = <A extends PlayTotals>(totals: readonly A[], limit: number): A[] =>
  totals
    .filter((entry) => entry.countedPlays > 0)
    // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh copy; Hermes lacks toSorted
    .sort(compareRanked)
    .slice(0, limit);

/** The window `period` covers when the ranking is read at `now`. */
export const statsWindow = (period: StatsPeriod, now: number): StatsWindow => {
  switch (period) {
    case "week":
      return { from: now - 7 * DAY_MS, to: now };
    case "month":
      return { from: now - 30 * DAY_MS, to: now };
    case "year":
      return { from: yearBefore(now), to: now };
    case "all":
      return { from: null, to: now };
  }
};
