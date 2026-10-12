import { LIBRARY_SECTION_SLUGS, type LibrarySectionSlug } from "@wave/core";

/** A Library entry: its name, and what its list says while empty. */
export interface LibrarySection {
  readonly slug: LibrarySectionSlug;
  readonly label: string;
  readonly empty: string;
}

const COPY: Readonly<Record<LibrarySectionSlug, Omit<LibrarySection, "slug">>> = {
  playlists: {
    label: "Playlists",
    empty: "Make a playlist, then add songs, albums or artists to it from their menus.",
  },
  artists: { label: "Artists", empty: "Artists appear once Wave has scanned your music." },
  albums: { label: "Albums", empty: "Albums appear once Wave has scanned your music." },
  songs: { label: "Songs", empty: "Songs appear once Wave has scanned your music." },
  genres: { label: "Genres", empty: "Genres appear once Wave has scanned your music." },
  folders: { label: "Folders", empty: "Your music folders appear once Wave has scanned them." },
  favorites: {
    label: "Favorites",
    empty: "Star a song from its menu or from Now Playing to keep it here.",
  },
};

/** The Library's entries, in the order they are listed (Core's `LIBRARY_SECTION_SLUGS`). */
export const LIBRARY_SECTIONS: readonly LibrarySection[] = LIBRARY_SECTION_SLUGS.map((slug) => ({
  slug,
  ...COPY[slug],
}));

export const findSection = (slug: string): LibrarySection | undefined =>
  LIBRARY_SECTIONS.find((section) => section.slug === slug);
