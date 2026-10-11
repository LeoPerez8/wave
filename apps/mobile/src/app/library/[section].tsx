import { IconStack2 } from "@tabler/icons-react-native";
import { useLocalSearchParams } from "expo-router";
import { View } from "react-native";

import { grid } from "@/catalog/grid";
import { findSection, type LibrarySection } from "@/catalog/sections";
import { EmptyState } from "@/components/EmptyState";
import { ScreenHeader } from "@/components/ScreenHeader";
import { AlbumsList, ArtistsList, FoldersList, GenresList } from "@/library/BrowseLists";
import { FavoritesList } from "@/library/FavoritesList";
import { PlaylistsList } from "@/library/PlaylistsList";
import { SongsList } from "@/library/SongsList";

function SectionList({ section }: { section: LibrarySection | undefined }) {
  switch (section?.slug) {
    case "songs":
      return <SongsList />;
    case "albums":
      return <AlbumsList empty={section.empty} />;
    case "artists":
      return <ArtistsList empty={section.empty} />;
    case "genres":
      return <GenresList empty={section.empty} />;
    case "folders":
      return <FoldersList empty={section.empty} />;
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

/** A Library list: Playlists, Artists, Albums, Songs, Genres, Folders or Favorites. */
export default function LibrarySectionScreen() {
  const { section: slug } = useLocalSearchParams<{ section: string }>();
  const section = findSection(slug);
  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title={section?.label ?? "Library"} />
      <SectionList section={section} />
    </View>
  );
}
