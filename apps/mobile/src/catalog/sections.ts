import {
  IconCategory,
  IconDisc,
  IconFolder,
  IconMicrophone2,
  IconMusic,
  IconPlaylist,
  IconStar,
} from "@tabler/icons-react-native";

/** The Library's entries, in the order they are listed, with the icon a shortcut tab shows. */
export const LIBRARY_SECTIONS = [
  {
    slug: "playlists",
    icon: IconPlaylist,
    label: "Playlists",
    empty: "Make a playlist, then add songs, albums or artists to it from their menus.",
  },
  {
    slug: "artists",
    icon: IconMicrophone2,
    label: "Artists",
    empty: "Artists appear once Wave has scanned your music.",
  },
  {
    slug: "albums",
    icon: IconDisc,
    label: "Albums",
    empty: "Albums appear once Wave has scanned your music.",
  },
  {
    slug: "songs",
    icon: IconMusic,
    label: "Songs",
    empty: "Songs appear once Wave has scanned your music.",
  },
  {
    slug: "genres",
    icon: IconCategory,
    label: "Genres",
    empty: "Genres appear once Wave has scanned your music.",
  },
  {
    slug: "folders",
    icon: IconFolder,
    label: "Folders",
    empty: "Your music folders appear once Wave has scanned them.",
  },
  {
    slug: "favorites",
    icon: IconStar,
    label: "Favorites",
    empty: "Star a song from its menu or from Now Playing to keep it here.",
  },
] as const;

export type LibrarySection = (typeof LIBRARY_SECTIONS)[number];

export const findSection = (slug: string): LibrarySection | undefined =>
  LIBRARY_SECTIONS.find((section) => section.slug === slug);
