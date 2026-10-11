/**
 * A favorite star while its writes to the library are in flight: it flips at
 * once, and should writes fail it goes back to what the library holds. Writes
 * settle in the order they were made.
 */
export interface FavoriteStar {
  /** What the UI shows: the latest toggle, or the library's value once writes settle. */
  readonly shown: boolean;
  /** What the library holds, as far as the writes saved so far tell. */
  readonly saved: boolean;
  /** Writes not settled yet. */
  readonly pending: number;
}

/** A star as the library holds it, with no write in flight. */
export const favoriteStar = (saved: boolean): FavoriteStar => ({
  shown: saved,
  saved,
  pending: 0,
});

/** The owner starred (`on`) or unstarred the track; its write starts. */
export const starWriteStarted = (star: FavoriteStar, on: boolean): FavoriteStar => ({
  ...star,
  shown: on,
  pending: star.pending + 1,
});

/**
 * The oldest write in flight settled: saved with its value, or failed (null).
 * Once none is left in flight the star shows what the library holds; until
 * then the latest toggle keeps showing.
 */
export const starWriteSettled = (star: FavoriteStar, saved: boolean | null): FavoriteStar => {
  const next = { ...star, saved: saved ?? star.saved, pending: Math.max(0, star.pending - 1) };
  return next.pending === 0 ? favoriteStar(next.saved) : next;
};
