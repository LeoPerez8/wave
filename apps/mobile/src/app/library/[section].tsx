import { useLocalSearchParams } from "expo-router";
import { View } from "react-native";

import { findSection } from "@/catalog/sections";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useLocalisation } from "@/localisation/localisation";
import { SectionList } from "@/library/SectionList";
import { sectionTitleLongPress } from "@/library/sectionTitleLongPress";

/** A Library list: Playlists, Artists, Albums, Songs, Genres or Favorites. */
export default function LibrarySectionScreen() {
  const { section: slug } = useLocalSearchParams<{ section: string }>();
  const { strings } = useLocalisation();
  const section = findSection(slug);
  return (
    <View className="flex-1 bg-background">
      <ScreenHeader
        title={section === undefined ? strings.tabs.library : strings.tabs[section.slug]}
        titleLongPress={sectionTitleLongPress(section)}
      />
      <SectionList section={section} />
    </View>
  );
}
