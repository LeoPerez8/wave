/**
 * Kept play totals (#1349): the Library keeps each song's counted plays, and
 * each album's and artist's, summed per UTC day and per block of
 * `KEPT_BLOCK_DAYS` days as plays are written, so a total over a window is a
 * lookup of a few rows rather than a sum over the history. These are the
 * rules for which kept rows, and which plays, a window is read from.
 */
import type { StatsWindow } from "./stats.ts";

/** A kept day's length: plays sum into UTC days. */
export const KEPT_DAY_MS = 86_400_000;
const DAY_MS = KEPT_DAY_MS;

/** How many UTC days one kept block sums. */
export const KEPT_BLOCK_DAYS = 32;

/** The kept day and block a play that started at [startedAt] is summed into. */
export const playBuckets = (startedAt: number): { day: number; block: number } => {
  const day = Math.floor(startedAt / DAY_MS);
  return { day, block: Math.floor(day / KEPT_BLOCK_DAYS) };
};

/** An inclusive range: of block or day numbers, or of play start times. */
export interface KeptRange {
  readonly from: number;
  readonly to: number;
}

/**
 * What a window's totals are read from: the kept blocks it covers whole, the
 * kept days it covers whole outside those blocks, and the plays of the days
 * it covers only in part. Together they hold each play of the window once.
 * All time starts at the epoch.
 */
export interface KeptTotalsPlan {
  readonly blocks: KeptRange | null;
  readonly days: readonly KeptRange[];
  readonly plays: readonly KeptRange[];
}

export const keptTotalsPlan = (window: StatsWindow): KeptTotalsPlan => {
  const start = window.from ?? 0;
  const { to } = window;
  if (to < start) return { blocks: null, days: [], plays: [] };
  const firstDay = Math.ceil(start / DAY_MS);
  const lastDay = Math.floor((to + 1) / DAY_MS) - 1;
  if (firstDay > lastDay) return { blocks: null, days: [], plays: [{ from: start, to }] };
  const plays: KeptRange[] = [];
  if (start < firstDay * DAY_MS) plays.push({ from: start, to: firstDay * DAY_MS - 1 });
  if ((lastDay + 1) * DAY_MS <= to) plays.push({ from: (lastDay + 1) * DAY_MS, to });
  const firstBlock = Math.ceil(firstDay / KEPT_BLOCK_DAYS);
  const lastBlock = Math.floor((lastDay + 1) / KEPT_BLOCK_DAYS) - 1;
  if (firstBlock > lastBlock)
    return { blocks: null, days: [{ from: firstDay, to: lastDay }], plays };
  const days: KeptRange[] = [];
  if (firstDay < firstBlock * KEPT_BLOCK_DAYS)
    days.push({ from: firstDay, to: firstBlock * KEPT_BLOCK_DAYS - 1 });
  if ((lastBlock + 1) * KEPT_BLOCK_DAYS <= lastDay)
    days.push({ from: (lastBlock + 1) * KEPT_BLOCK_DAYS, to: lastDay });
  return { blocks: { from: firstBlock, to: lastBlock }, days, plays };
};
