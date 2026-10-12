import {
  IconCategory,
  IconDisc,
  IconFolder,
  IconMicrophone2,
  IconMusic,
  IconPlaylist,
  IconStar,
  type Icon,
} from "@tabler/icons-react-native";
import { LIBRARY_SECTION_SLUGS, type LibrarySectionSlug } from "@wave/core";

/** A Library entry: its name, the icon a shortcut tab shows, and what its list says while empty. */
export interface LibrarySection {
  readonly slug: LibrarySectionSlug;
  readonly icon: Icon;
  readonly label: string;
  readonly empty: string;
}

const COPY: Readonly<Record<LibrarySectionSlug, Omit<LibrarySection, "slug">>> = {
  playlists: {
    icon: IconPlaylist,
    label: "Playlists",
    empty: "Make a playlist, then add songs, albums or artists to it from their menus.",
  },
  artists: {
    icon: IconMicrophone2,
    label: "Artists",
    empty: "Artists appear once Wave has scanned your music.",
  },
  albums: {
    icon: IconDisc,
    label: "Albums",
    empty: "Albums appear once Wave has scanned your music.",
  },
  songs: {
    icon: IconMusic,
    label: "Songs",
    empty: "Songs appear once Wave has scanned your music.",
  },
  genres: {
    icon: IconCategory,
    label: "Genres",
    empty: "Genres appear once Wave has scanned your music.",
  },
  folders: {
    icon: IconFolder,
    label: "Folders",
    empty: "Your music folders appear once Wave has scanned them.",
  },
  favorites: {
    icon: IconStar,
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
