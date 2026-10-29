import {
  IconCategory,
  IconDisc,
  IconMicrophone2,
  IconMusic,
  IconPlaylist,
  IconStar,
  type Icon,
} from "@tabler/icons-react-native";
import { LIBRARY_SECTION_SLUGS, type LibrarySectionSlug } from "@wave/core";

import { currentLocalisation } from "@/localisation/localisation";

/** A Library entry: its name, the icon its tab shows, and what its list says while empty. */
export interface LibrarySection {
  readonly slug: LibrarySectionSlug;
  readonly icon: Icon;
  readonly label: string;
  readonly empty: string;
}

const ICONS: Readonly<Record<LibrarySectionSlug, Icon>> = {
  playlists: IconPlaylist,
  artists: IconMicrophone2,
  albums: IconDisc,
  songs: IconMusic,
  genres: IconCategory,
  favorites: IconStar,
};

/**
 * The Library's entries, in the order they are listed (Core's `LIBRARY_SECTION_SLUGS`).
 * Their name and empty line read the catalogue when asked, so they're always in
 * the language Wave reads in; screens showing them re-render through `useLocalisation`.
 */
export const LIBRARY_SECTIONS: readonly LibrarySection[] = LIBRARY_SECTION_SLUGS.map((slug) => ({
  slug,
  icon: ICONS[slug],
  get label() {
    return currentLocalisation().strings.tabs[slug];
  },
  get empty() {
    return currentLocalisation().strings.library.sectionEmpty[slug];
  },
}));

export const findSection = (slug: string): LibrarySection | undefined =>
  LIBRARY_SECTIONS.find((section) => section.slug === slug);
