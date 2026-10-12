import { useLocalSearchParams } from "expo-router";
import { View } from "react-native";

import { findSection } from "@/catalog/sections";
import { ScreenHeader } from "@/components/ScreenHeader";
import { SectionList } from "@/library/SectionList";

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
