import { IconStack2 } from "@tabler/icons-react-native";
import { useLocalSearchParams } from "expo-router";
import { View } from "react-native";

import { grid } from "@/catalog/grid";
import { findSection } from "@/catalog/sections";
import { EmptyState } from "@/components/EmptyState";
import { ScreenHeader } from "@/components/ScreenHeader";
import { SongsList } from "@/library/SongsList";

/** A Library list. Songs come from the scanner; the rest wait for browsing (#10). */
export default function LibrarySectionScreen() {
  const { section: slug } = useLocalSearchParams<{ section: string }>();
  const section = findSection(slug);
  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title={section?.label ?? "Library"} />
      {section?.slug === "songs" ? (
        <SongsList />
      ) : (
        <View style={{ paddingHorizontal: grid.margin }}>
          <EmptyState
            icon={IconStack2}
            title="Nothing here yet"
            message={section?.empty ?? "This part of the library doesn't exist."}
          />
        </View>
      )}
    </View>
  );
}
