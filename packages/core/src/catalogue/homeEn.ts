import type { HomeSectionId } from "../homeSections.ts";

/** Home: its title's button, section titles, empty states and edit mode. */
export const homeEn = {
  /** Home's large title, after the two waves: Wave's name, the same in every language. */
  title: "Wave",
  /** Each section's title, in sentence case as Home heads it (the followed artists' sections and Community playlists have their own). */
  sections: {
    dj: "DJ",
    discover: "Discover",
    "in-your-orbit": "In your orbit",
    "from-your-library": "From your library",
    "recently-added": "Recently added",
    "recently-played": "Recently played",
    "most-played": "Most played",
    "most-played-albums": "Most played albums",
    "most-played-artists": "Most played artists",
    favorites: "Favorites",
    stats: "Stats",
  } satisfies Record<
    Exclude<HomeSectionId, "new-releases" | "upcoming-shows" | "community-playlists">,
    string
  >,
  /** Recently played's cards that name no song, album, artist or Library playlist. */
  recentlyPlayed: {
    /** A YouTube Music playlist whose title Wave never kept. */
    playlist: "Playlist",
    /** A mix's card, by the kind of mix it was. */
    mixes: {
      magic: "Magic Queue",
      dj: "DJ",
      discoverMix: "Mix",
      mix: "Mix",
      related: "Related",
      newReleases: "New releases",
    } as Record<string, string>,
    /** A mix's card for screen readers: a tap plays it again. */
    playAgain: (mix: string) => `Play ${mix} again`,
    /** A mix's card tapped, and its songs couldn't be read. */
    playAgainFailed: "Couldn't play the mix again",
  },
  settings: "Settings",
  seeAll: "See all",
  emptyTitle: "Nothing here yet",
  emptyMessage: "Your recently added, recently played and most played music will show up here.",
  noSections: "Long-press Home to add sections back.",
  playHint: "Play something, and what you listen to will show up here.",
  edit: "Edit Home",
  notOnHome: "Not on Home",
};
