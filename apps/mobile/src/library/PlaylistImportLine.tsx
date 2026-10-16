import { playlistImportView, type ImportNotice, type PlaylistImportView } from "@wave/core";
import { ScrollView, Text, View } from "react-native";

import { CELL } from "@/catalog/grid";
import { TextButton } from "@/components/TextButton";
import { presentOverlay } from "@/overlay/overlay";

import {
  cancelPlaylistImport,
  tryPlaylistImportAgain,
  usePlaylistImports,
} from "./playlistImports";

/** What [playlistId]'s page shows of its link import (Core's `playlistImportView`); null with none. */
export const usePlaylistImportView = (playlistId: number): PlaylistImportView | null =>
  playlistImportView(usePlaylistImports(), playlistId);

/**
 * The playlist page's import line, under its length: how far the import has
 * got with Cancel, why it stopped with Try Again, or, once done, how many
 * songs weren't found, with Show (the list) and Dismiss.
 */
export function PlaylistImportLine({ playlistId }: { playlistId: number }) {
  const view = usePlaylistImportView(playlistId);
  if (view === null) return null;
  const { notFound } = view;
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
        {notFound !== null && (
          <TextButton label="Show" opensMenu onPress={() => void showNotFound(notFound)} />
        )}
        {notFound !== null && (
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

/** The songs an import didn't find, scrolling when they don't fit. */
const showNotFound = (notice: ImportNotice): Promise<void> =>
  presentOverlay<void>({
    label: notice.title,
    dismissed: undefined,
    render: (finish) => <NotFoundCard notice={notice} finish={() => finish(undefined)} />,
  });

function NotFoundCard({ notice, finish }: { notice: ImportNotice; finish: () => void }) {
  return (
    <>
      <View style={{ gap: CELL, paddingTop: CELL, paddingBottom: CELL * 2, flexShrink: 1 }}>
        <Text className="font-sans text-title3 font-normal text-foreground">{notice.title}</Text>
        <ScrollView bounces={false} overScrollMode="never" style={{ flexGrow: 0 }}>
          <Text className="font-sans text-subheadline text-secondary">{notice.message}</Text>
        </ScrollView>
      </View>
      <View className="flex-row items-center justify-end">
        <TextButton label="OK" onPress={finish} />
      </View>
    </>
  );
}
