import type { HomeSectionId } from "../homeSections.ts";

/** Home: its title's button, section titles, empty states and edit mode. */
export const homeEn = {
  /** Each section's title, in sentence case as Home heads it (followed artists' have their own). */
  sections: {
    discover: "Discover",
    "recently-added": "Recently added",
    "recently-played": "Recently played",
    "most-played": "Most played",
    "most-played-albums": "Most played albums",
    "most-played-artists": "Most played artists",
    favorites: "Favorites",
    stats: "Stats",
  } satisfies Record<Exclude<HomeSectionId, "new-releases" | "upcoming-shows">, string>,
  settings: "Settings",
  seeAll: "See all",
  emptyTitle: "Nothing here yet",
  emptyMessage: "Your recently added, recently played and most played music will show up here.",
  noSections: "Long-press Home to add sections back.",
  playHint: "Play something, and what you listen to will show up here.",
  loadingStats: "Loading Stats",
  loadingArtists: "Loading artists",
  loadingAlbums: "Loading albums",
  edit: "Edit Home",
  notOnHome: "Not on Home",
};
