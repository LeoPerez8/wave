import { IconSettings, IconStack2 } from "@tabler/icons-react-native";
import { router } from "expo-router";
import { View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { EntryRow } from "@/catalog/EntryRow";
import { Hairline } from "@/catalog/Hairline";
import { LIBRARY_SECTIONS } from "@/catalog/sections";
import { EmptyState } from "@/components/EmptyState";
import { IconButton } from "@/components/IconButton";
import { LargeTitleScreen } from "@/components/LargeTitleScreen";

export default function LibraryScreen() {
  return (
    <LargeTitleScreen
      title="Library"
      action={
        <IconButton icon={IconSettings} label="Settings" onPress={() => router.push("/settings")} />
      }
    >
      <Hairline />
      {LIBRARY_SECTIONS.map((section) => (
        <EntryRow
          key={section.slug}
          label={section.label}
          onPress={() => router.push(`/library/${section.slug}`)}
        />
      ))}
      <View className="mt-12">
        <CatalogLine>Recently added</CatalogLine>
        <EmptyState
          icon={IconStack2}
          title="No music yet"
          message="Albums from your Music folder will appear here once Wave can scan your library."
        />
      </View>
    </LargeTitleScreen>
  );
}
