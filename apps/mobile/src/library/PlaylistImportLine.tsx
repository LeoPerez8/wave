import { playlistImportView, type ImportLeftOut, type PlaylistImportView } from "@wave/core";
import { ScrollView, Text, View } from "react-native";

import { CELL } from "@/catalog/grid";
import { TextButton } from "@/components/TextButton";
import { presentOverlay } from "@/overlay/overlay";
import { useRenderCount } from "@/perf/perf";

import { cancelPlaylistImport, usePlaylistImports } from "./playlistImports";

/** What [playlistId]'s page shows of its link import (Core's `playlistImportView`); null with none. */
export const usePlaylistImportView = (playlistId: number): PlaylistImportView | null =>
  playlistImportView(usePlaylistImports(), playlistId);

/**
 * The playlist page's import line, under its length, once the import is
 * done: how many songs were listed twice (or, of an import an older Wave
 * kept, weren't found), with Show (the list) and Dismiss.
 */
export function PlaylistImportLine({ playlistId }: { playlistId: number }) {
  useRenderCount("PlaylistImportLine");
  const view = usePlaylistImportView(playlistId);
  if (view === null) return null;
  const { leftOut } = view;
  return (
    <View>
      <Text
        accessibilityLiveRegion="polite"
        className="font-sans text-footnote text-accent"
        style={{ fontVariant: ["tabular-nums"] }}
      >
        {view.line}
      </Text>
      <View className="flex-row items-center" style={{ gap: CELL * 3 }}>
        <TextButton label="Show" opensMenu onPress={() => void showLeftOut(leftOut)} />
        <TextButton label="Dismiss" onPress={() => cancelPlaylistImport(playlistId)} />
      </View>
    </View>
  );
}

/** The songs an import left out, under their headings, scrolling when they don't fit. */
const showLeftOut = (leftOut: ImportLeftOut): Promise<void> =>
  presentOverlay<void>({
    label: leftOut.title,
    dismissed: undefined,
    render: (finish) => <LeftOutCard leftOut={leftOut} finish={() => finish(undefined)} />,
  });

function LeftOutCard({ leftOut, finish }: { leftOut: ImportLeftOut; finish: () => void }) {
  return (
    <>
      <View style={{ gap: CELL, paddingTop: CELL, paddingBottom: CELL * 2, flexShrink: 1 }}>
        <Text className="font-sans text-title3 font-normal text-foreground">{leftOut.title}</Text>
        <ScrollView bounces={false} overScrollMode="never" style={{ flexGrow: 0 }}>
          <Text className="font-sans text-subheadline text-secondary">{leftOut.message}</Text>
          {leftOut.sections.map((section) => (
            <View key={section.heading} style={{ paddingTop: CELL * 2, gap: CELL / 2 }}>
              <Text
                accessibilityRole="header"
                className="font-sans text-subheadline font-medium text-foreground"
              >
                {section.heading}
              </Text>
              <Text className="font-sans text-subheadline text-secondary">
                {section.songs.join("\n")}
              </Text>
            </View>
          ))}
        </ScrollView>
      </View>
      <View className="flex-row items-center justify-end">
        <TextButton label="OK" onPress={finish} />
      </View>
    </>
  );
}
