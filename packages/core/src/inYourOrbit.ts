/**
 * The desktop Home's In your orbit (`apps/desktop`): the artists with the most
 * counted plays in the recent window (`recentWindow.ts`), streamed plays
 * included, credited as Stats credits them, so a collaboration counts for each
 * artist it names. The phone's In your orbit ranks songs instead
 * (`inYourOrbitSongs`).
 */
import { recentWindowStart } from "./recentWindow.ts";
import { rankEntityPlays, type EntityPlayTotals, type StatsWindow } from "./stats.ts";

/** How many artists the section's row holds. */
export const IN_YOUR_ORBIT_ARTISTS = 10;

/** The plays In your orbit reads at `now`: the recent window, as Stats reads a period. */
export const inYourOrbitWindow = (now: number): StatsWindow => ({
  from: recentWindowStart(now),
  to: now,
});

/**
 * The section's artists, the most played first, of each artist's [totals]
 * over `inYourOrbitWindow` (Library artists and online ones alike). Ties
 * break as in Stats. Empty when nothing was played in the window, and then
 * Home leaves the section out.
 */
export const inYourOrbit = <A extends EntityPlayTotals>(totals: readonly A[]): A[] =>
  rankEntityPlays(totals, IN_YOUR_ORBIT_ARTISTS);
