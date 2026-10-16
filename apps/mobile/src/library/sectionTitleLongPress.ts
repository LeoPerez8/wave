import type { LibrarySection } from "@/catalog/sections";
import type { TitleLongPress } from "@/components/TitleLongPress";

import { playlistLayoutTitleLongPress } from "./playlistLayout";

/**
 * What a long press on a Library section's title opens, where it opens
 * anything (Playlists: its layouts), on its own screen and as the shortcut tab.
 */
export const sectionTitleLongPress = (
  section: LibrarySection | undefined,
): TitleLongPress | undefined =>
  section?.slug === "playlists" ? playlistLayoutTitleLongPress : undefined;
