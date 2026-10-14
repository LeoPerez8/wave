import { IconStack2 } from "@tabler/icons-react-native";
import { View } from "react-native";

import { grid } from "@/catalog/grid";
import type { LibrarySection } from "@/catalog/sections";
import { EmptyState } from "@/components/EmptyState";

import { AlbumsList, ArtistsList, GenresList } from "./BrowseLists";
import { FavoritesList } from "./FavoritesList";
import { PlaylistsList } from "./PlaylistsList";
import { SongsList } from "./SongsList";

/** A Library section's list, on its own screen or as the shortcut tab. */
export function SectionList({ section }: { section: LibrarySection | undefined }) {
  switch (section?.slug) {
    case "songs":
      return <SongsList />;
    case "albums":
      return <AlbumsList empty={section.empty} />;
    case "artists":
      return <ArtistsList empty={section.empty} />;
    case "genres":
      return <GenresList empty={section.empty} />;
    case "playlists":
      return <PlaylistsList empty={section.empty} />;
    case "favorites":
      return <FavoritesList empty={section.empty} />;
    default:
      return (
        <View style={{ paddingHorizontal: grid.margin }}>
          <EmptyState
            icon={IconStack2}
            title="Nothing here yet"
            message="This part of the library doesn't exist."
          />
        </View>
      );
  }
}
