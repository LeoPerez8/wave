import { playlistImportView, type ImportLeftOut, type PlaylistImportView } from "@wave/core";
import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { CELL } from "@/catalog/grid";
import { TextButton } from "@/components/TextButton";
import { presentOverlay } from "@/overlay/overlay";
import { useRenderCount } from "@/perf/perf";

import {
  cancelPlaylistImport,
  tryPlaylistImportAgain,
  usePlaylistImports,
  useSpotifySearches,
} from "./playlistImports";

/** How often the time left is worked out again, as it changes even while the import waits. */
const TICK_MS = 5000;

/**
 * What [playlistId]'s page shows of its link import (Core's
 * `playlistImportView`), the time left ticking while it imports; null with none.
 */
export const usePlaylistImportView = (playlistId: number): PlaylistImportView | null => {
  const imports = usePlaylistImports();
  const searches = useSpotifySearches();
  const [now, setNow] = useState(Date.now);
  const importing = imports.some(
    (job) => job.playlistId === playlistId && job.state.kind === "importing",
  );
  useEffect(() => {
    if (!importing) return undefined;
    const tick = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(tick);
  }, [importing]);
  return playlistImportView(imports, playlistId, now, searches);
};

/**
 * The playlist page's import line, under its length: how far the import has
 * got with Cancel, why it stopped with Try Again, or, once done, how many
 * songs weren't found or were listed twice, with Show (the list) and Dismiss.
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
        {leftOut !== null && (
          <TextButton label="Show" opensMenu onPress={() => void showLeftOut(leftOut)} />
        )}
        {leftOut !== null && (
          <TextButton label="Dismiss" onPress={() => cancelPlaylistImport(playlistId)} />
        )}
        {view.canRetry && (
          <TextButton label="Try Again" onPress={() => tryPlaylistImportAgain(playlistId)} />
        )}
        {view.canCancel && (
          <TextButton label="Cancel" onPress={() => cancelPlaylistImport(playlistId)} />
        )}
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
