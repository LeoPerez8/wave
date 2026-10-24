/** Where a song's star was changed; Now Playing's star and cover confirm it themselves. */
export type FavoriteSource = "swipe" | "menu" | "selection" | "nowPlaying";

/** The confirmation for starring [count] songs, or none where the star already confirms it. */
export const favoriteToast = (source: FavoriteSource, on: boolean, count: number): string | null =>
  source === "nowPlaying" || !on || count < 1
    ? null
    : count === 1
      ? "Added to Favorites"
      : `Added ${count} songs to Favorites`;
