/**
 * How fast a Spotify import may search YouTube Music (docs/spec.md,
 * "Importing playlists from a link"): an allowance of searches in any 15
 * minutes, shared by the imports in turn and kept while Wave is closed.
 */

/** The YouTube Music searches Spotify imports asked lately, retries included. */
export interface SpotifySearchPacing {
  /** When each was asked (ms), oldest first; only the last `SPOTIFY_SEARCH_BUDGET` matter. */
  readonly searchesAt: readonly number[];
}

/**
 * At most this many searches in any `SPOTIFY_SEARCH_WINDOW_MS`. YouTube Music
 * began refusing some after about 2,300 searches in 15 minutes (measured
 * 2026-10-14), and 1,000 at a time never drew a refusal.
 */
export const SPOTIFY_SEARCH_BUDGET = 1000;
export const SPOTIFY_SEARCH_WINDOW_MS = 15 * 60_000;

/** The searches still in the window at [now], oldest first. */
const recent = (pacing: SpotifySearchPacing, now: number): readonly number[] =>
  pacing.searchesAt.filter((at) => at > now - SPOTIFY_SEARCH_WINDOW_MS);

/** When the next search may be asked (ms): [now], or once the window's oldest search leaves it. */
export const spotifySearchAllowedAt = (pacing: SpotifySearchPacing, now: number): number => {
  const inWindow = recent(pacing, now);
  const oldest = inWindow[inWindow.length - SPOTIFY_SEARCH_BUDGET];
  return oldest === undefined ? now : oldest + SPOTIFY_SEARCH_WINDOW_MS;
};

/** [pacing] once a search is asked at [now]. */
export const spotifySearchAsked = (
  pacing: SpotifySearchPacing,
  now: number,
): SpotifySearchPacing => ({
  searchesAt: [...recent(pacing, now), now].slice(-SPOTIFY_SEARCH_BUDGET),
});

/** [pacing] as kept until Wave starts again (`readSpotifySearchPacing`). */
export const writeSpotifySearchPacing = (pacing: SpotifySearchPacing): string =>
  JSON.stringify({ searchesAt: pacing.searchesAt.slice(-SPOTIFY_SEARCH_BUDGET) });

/** The searches kept as [stored] (`writeSpotifySearchPacing`); none when nothing readable is kept. */
export const readSpotifySearchPacing = (stored: string | null): SpotifySearchPacing => {
  if (stored === null) return { searchesAt: [] };
  try {
    const value: unknown = JSON.parse(stored);
    const searchesAt =
      typeof value === "object" && value !== null && "searchesAt" in value
        ? value.searchesAt
        : null;
    if (!Array.isArray(searchesAt)) return { searchesAt: [] };
    const times = searchesAt.filter((at): at is number => Number.isFinite(at));
    // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array; Hermes lacks toSorted
    return { searchesAt: times.sort((a, b) => a - b).slice(-SPOTIFY_SEARCH_BUDGET) };
  } catch {
    return { searchesAt: [] };
  }
};

/** About how long one search takes, four at once: 495 took 85 seconds (measured 2026-10-14). */
const SEARCH_MS = 170;

/**
 * About when [count] more searches will have been asked, the first no
 * sooner than [from] (ms), at about 6 a second and within the allowance
 * (given the searches [pacing] holds).
 *
 * Each search is asked as soon as both allow: a search after the one before,
 * and a window after the one an allowance before it. Once more than an
 * allowance of searches in a row each waited exactly that window, every
 * later one does too (the allowance's searches take less than a window), so
 * the rest repeat the last allowance's times a window later each time: the
 * work stays within a few allowances however many searches are left.
 */
export const spotifySearchesDoneAt = (
  pacing: SpotifySearchPacing,
  from: number,
  count: number,
): number => {
  const times = [...recent(pacing, from)];
  let at = from;
  /** How many searches in a row, up to the last, each came a window after the one an allowance before it. */
  let steady = 0;
  for (let search = 0; search < count; search += 1) {
    const oldest = times[times.length - SPOTIFY_SEARCH_BUDGET];
    if (oldest !== undefined) at = Math.max(at, oldest + SPOTIFY_SEARCH_WINDOW_MS);
    steady = oldest !== undefined && at === oldest + SPOTIFY_SEARCH_WINDOW_MS ? steady + 1 : 0;
    times.push(at);
    if (steady > SPOTIFY_SEARCH_BUDGET) {
      const left = count - search - 1;
      const windows = Math.ceil(left / SPOTIFY_SEARCH_BUDGET);
      const repeated = times[times.length - 1 + left - windows * SPOTIFY_SEARCH_BUDGET] ?? at;
      return repeated + windows * SPOTIFY_SEARCH_WINDOW_MS + SEARCH_MS;
    }
    at += SEARCH_MS;
  }
  return at;
};
