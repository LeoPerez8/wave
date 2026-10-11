import { IconSettings, IconStack2 } from "@tabler/icons-react-native";
import { router } from "expo-router";
import { Text, View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { EntryRow } from "@/catalog/EntryRow";
import { CELL } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { LIBRARY_SECTIONS } from "@/catalog/sections";
import { EmptyState } from "@/components/EmptyState";
import { IconButton } from "@/components/IconButton";
import { LargeTitleScreen } from "@/components/LargeTitleScreen";
import { ScanProgressBanner } from "@/components/ScanProgressBanner";
import { useScanState, useTrackCount } from "@/library/hooks";

/** Empty cover slots stand in for Recently Added until the first scan. */
const SLOT = CELL * 9;

export default function LibraryScreen() {
  const scan = useScanState();
  const trackCount = useTrackCount();
  const empty = scan.status === "done" && trackCount === 0;

  return (
    <LargeTitleScreen
      title="Library"
      action={
        <IconButton icon={IconSettings} label="Settings" onPress={() => router.push("/settings")} />
      }
    >
      <ScanProgressBanner />
      {empty && (
        <EmptyState
          icon={IconStack2}
          title="No music found"
          message="Wave didn't find any audio files in your Music folder. Copy some music there and it will show up here."
        />
      )}
      <Hairline />
      {LIBRARY_SECTIONS.map((section) => (
        <EntryRow
          key={section.slug}
          label={section.label}
          count={section.slug === "songs" ? (trackCount ?? undefined) : undefined}
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
