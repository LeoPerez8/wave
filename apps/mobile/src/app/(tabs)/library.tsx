import { IconSettings } from "@tabler/icons-react-native";
import { router } from "expo-router";
import { Text, View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { EntryRow } from "@/catalog/EntryRow";
import { CELL } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { LIBRARY_SECTIONS } from "@/catalog/sections";
import { IconButton } from "@/components/IconButton";
import { LargeTitleScreen } from "@/components/LargeTitleScreen";

/** Empty cover slots stand in for Recently Added until the first scan. */
const SLOT = CELL * 9;

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
      <View style={{ marginTop: CELL * 5, gap: CELL * 1.5 }}>
        <CatalogLine>Recently added</CatalogLine>
        <View accessible={false} className="flex-row" style={{ gap: CELL * 2 }}>
          {[0, 1, 2].map((slot) => (
            <View key={slot} className="bg-fill" style={{ width: SLOT, height: SLOT }} />
          ))}
        </View>
        <Text className="font-sans text-subheadline text-secondary">
          No albums yet. They appear here as Wave scans your Music folder.
        </Text>
      </View>
    </LargeTitleScreen>
  );
}
