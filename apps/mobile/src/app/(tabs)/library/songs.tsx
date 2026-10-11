import { LegendList } from "@legendapp/list/react-native";
import { IconMusic } from "@tabler/icons-react-native";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { ScanProgressBanner } from "@/components/ScanProgressBanner";
import { SONG_ROW_HEIGHT, SongRow } from "@/components/SongRow";
import { useScanState, useSongs } from "@/library/hooks";
import type { SongRow as Song } from "@/library/LibraryStore";

const keyExtractor = (song: Song): string => String(song.id);
const renderItem = ({ item }: { item: Song }) => <SongRow song={item} />;

/** Library › Songs: every track by title, virtualised for libraries of tens of thousands. */
export default function SongsScreen() {
  const songs = useSongs();
  const scan = useScanState();
  const insets = useSafeAreaInsets();

  if (songs.length === 0) {
    return (
      <View className="flex-1 bg-background px-5 pt-4">
        <ScanProgressBanner />
        {scan.status === "scanning" ? (
          <Text className="text-center font-sans text-subheadline text-secondary">
            Songs appear here as Wave finds them.
          </Text>
        ) : (
          <EmptyState icon={IconMusic} title="No songs" message="Your Music folder has no songs yet." />
        )}
      </View>
    );
  }

  return (
    <LegendList
      className="flex-1 bg-background"
      data={songs}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      estimatedItemSize={SONG_ROW_HEIGHT}
      recycleItems
      contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
      ListHeaderComponent={
        <View className="px-5 pt-2">
          <ScanProgressBanner />
          <Text className="pb-2 font-sans text-footnote text-secondary">
            {songs.length.toLocaleString("en-US")} {songs.length === 1 ? "song" : "songs"}
          </Text>
        </View>
      }
    />
  );
}
