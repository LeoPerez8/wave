/**
 * "Recently" on Home: the window of counted plays that feeds
 * In your orbit and From your library.
 */

/** How many days back "recently" reaches. */
export const RECENT_WINDOW_DAYS = 14;

const DAY_MS = 86_400_000;

/** The first instant inside the window that ends at `now` (epoch milliseconds). */
export const recentWindowStart = (now: number): number => now - RECENT_WINDOW_DAYS * DAY_MS;

/** Whether a play that started at `at` falls inside the window that ends at `now`. */
export const isRecent = (at: number, now: number): boolean =>
  at >= recentWindowStart(now) && at <= now;
