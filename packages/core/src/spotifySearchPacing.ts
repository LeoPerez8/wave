/** Shared YouTube Music search allowance for Spotify imports, including retries and app restarts. */
export interface SpotifySearchPacing {
  readonly searchesAt: readonly number[];
}

/** Half a second between requests avoids spending the window's budget in one burst. */
const SEARCH_GAP_MS = 500;
/** Below the measured refusals near 2,300 searches in fifteen minutes (#241). */
const SEARCH_WINDOW_MS = 15 * 60_000;
const SEARCH_BUDGET = 1200;

/** Reserve an allowance only for a search the app is about to send, never for a Library match. */
export const nextSpotifySearch = (
  pacing: SpotifySearchPacing,
  now: number,
): { readonly kind: "search"; readonly pacing: SpotifySearchPacing } | { readonly kind: "wait"; readonly untilMs: number } => {
  const searchesAt = pacing.searchesAt.filter((at) => at > now - SEARCH_WINDOW_MS);
  const last = searchesAt.at(-1);
  const budgetAt = searchesAt.length >= SEARCH_BUDGET
    ? (searchesAt[searchesAt.length - SEARCH_BUDGET] ?? now) + SEARCH_WINDOW_MS
    : now;
  const untilMs = Math.max(budgetAt, last === undefined ? now : last + SEARCH_GAP_MS);
  if (now < untilMs) return { kind: "wait", untilMs };
  return { kind: "search", pacing: { searchesAt: [...searchesAt, now] } };
};
