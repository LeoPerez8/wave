import { IconStack2 } from "@tabler/icons-react-native";
import { useLocalSearchParams } from "expo-router";
import { View } from "react-native";

import { grid } from "@/catalog/grid";
import { findSection } from "@/catalog/sections";
import { EmptyState } from "@/components/EmptyState";
import { ScreenHeader } from "@/components/ScreenHeader";

/** A Library list. Empty until the scanner (#5) and browsing (#10) fill it. */
export default function LibrarySectionScreen() {
  const { section: slug } = useLocalSearchParams<{ section: string }>();
  const section = findSection(slug);
  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title={section?.label ?? "Library"} />
      <View style={{ paddingHorizontal: grid.margin }}>
        <EmptyState
          icon={IconStack2}
          title="Nothing here yet"
          message={section?.empty ?? "This part of the library doesn't exist."}
        />
      </View>
    </View>
  );
}
