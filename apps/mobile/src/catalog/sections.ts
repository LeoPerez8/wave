/** The Library's entries, in the order they are listed. */
export const LIBRARY_SECTIONS = [
  { slug: "playlists", label: "Playlists", empty: "Playlists you make will be listed here." },
  { slug: "artists", label: "Artists", empty: "Artists appear once Wave has scanned your music." },
  { slug: "albums", label: "Albums", empty: "Albums appear once Wave has scanned your music." },
  { slug: "songs", label: "Songs", empty: "Songs appear once Wave has scanned your music." },
  { slug: "genres", label: "Genres", empty: "Genres appear once Wave has scanned your music." },
  {
    slug: "folders",
    label: "Folders",
    empty: "Your music folders appear once Wave has scanned them.",
  },
  { slug: "favorites", label: "Favorites", empty: "Star a song to keep it here." },
] as const;

export type LibrarySection = (typeof LIBRARY_SECTIONS)[number];

export const findSection = (slug: string): LibrarySection | undefined =>
  LIBRARY_SECTIONS.find((section) => section.slug === slug);
