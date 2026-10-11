import { LegendList } from "@legendapp/list/react-native";
import { IconMusic } from "@tabler/icons-react-native";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL, grid } from "@/catalog/grid";
import { type TrackSummary, TrackRow } from "@/catalog/TrackRow";
import { EmptyState } from "@/components/EmptyState";
import { ScanProgressBanner } from "@/components/ScanProgressBanner";

import { useScanState, useSongs } from "./hooks";
import type { SongRow } from "./LibraryStore";

const toSummary = (song: SongRow): TrackSummary => ({
  id: String(song.id),
  title: song.title,
  artist: song.artist,
  durationMs: song.durationMs,
  artworkUri: song.thumbPath === null ? undefined : `file://${song.thumbPath}`,
});

const keyExtractor = (song: SongRow): string => String(song.id);

// Playback arrives with #6; until then a tap does nothing.
const renderItem = ({ item }: { item: SongRow }) => (
  <TrackRow track={toSummary(item)} leading="artwork" onPress={() => undefined} />
);

/** Library › Songs: every track by title, virtualised for libraries of tens of thousands. */
export function SongsList() {
  const songs = useSongs();
  const scan = useScanState();
  const insets = useSafeAreaInsets();

  if (songs.length === 0) {
    return (
      <View style={{ paddingHorizontal: grid.margin }}>
        <ScanProgressBanner />
        <EmptyState
          icon={IconMusic}
          title={scan.status === "scanning" ? "Looking for songs" : "No songs"}
          message={
            scan.status === "scanning"
              ? "Songs appear here as Wave finds them."
              : "Wave didn't find any songs in your Music folder."
          }
        />
      </View>
    );
  }

  return (
    <LegendList
      className="flex-1"
      data={songs}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      estimatedItemSize={grid.row}
      recycleItems
      contentContainerStyle={{
        paddingHorizontal: grid.margin,
        paddingBottom: insets.bottom + CELL * 6,
      }}
      ListHeaderComponent={
        <View style={{ paddingBottom: CELL }}>
          <ScanProgressBanner />
          <CatalogLine>
            {`${songs.length.toLocaleString("en")} ${songs.length === 1 ? "song" : "songs"}`}
          </CatalogLine>
        </View>
      }
    />
  );
}
