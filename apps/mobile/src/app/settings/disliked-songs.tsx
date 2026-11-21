import { LegendList } from "@legendapp/list/react-native";
import type { DislikedSongRow } from "@wave/core";
import { memo } from "react";
import { Text, View } from "react-native";

import { grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { TextButton } from "@/components/TextButton";
import { useScreenContent } from "@/lib/screenTiming";
import { useDislikedSongList } from "@/library/dislikedSongList";
import { forgetDislikes } from "@/library/dislikes";
import { useLocalisation } from "@/localisation/localisation";
import { SECTION_GAP, SettingsEditorScreen } from "@/settings/SettingsPage";

/** About a row's height: its title and artist lines with their padding. */
const ROW_ESTIMATE = 64;

/** A disliked song: its title and artist as they were listed, and Remove, over a hairline. */
const DislikedSongItem = memo(function DislikedSongItem({ song }: { song: DislikedSongRow }) {
  const { strings } = useLocalisation();
  return (
    <View>
      <View className="flex-row items-center py-2" style={{ minHeight: grid.row }}>
        <View
          className="flex-1"
          accessible
          accessibilityLabel={[song.title, song.artist].filter(Boolean).join(", ")}
        >
          <Text numberOfLines={1} className="font-sans text-body font-medium text-foreground">
            {song.title}
          </Text>
          {song.artist !== "" && (
            <Text numberOfLines={1} className="font-sans text-body text-secondary">
              {song.artist}
            </Text>
          )}
        </View>
        <TextButton
          variant="plain"
          label={strings.settings.remove}
          accessibilityLabel={strings.settings.removeDislikeOf(song.title)}
          // Removing a dislike leaves the star alone and says nothing (Core's `dislikeSongs`).
          onPress={() => void forgetDislikes([song.key])}
        />
      </View>
      <Hairline />
    </View>
  );
});

const keyOf = (song: DislikedSongRow): string => song.key;
const renderItem = ({ item }: { item: DislikedSongRow }) => <DislikedSongItem song={item} />;

/**
 * Settings › Disliked songs: every disliked song, the Library's and YT Music's
 * alike, the newest first, each with Remove, which takes it off the list and
 * lets Wave pick it again. With none, a line says so.
 */
export default function DislikedSongsSettingsScreen() {
  const { strings } = useLocalisation();
  const songs = useDislikedSongList();
  useScreenContent(songs !== null);
  return (
    <SettingsEditorScreen page="dislikedSongs">
      <LegendList
        className="flex-1"
        data={songs ?? []}
        keyExtractor={keyOf}
        renderItem={renderItem}
        estimatedItemSize={ROW_ESTIMATE}
        recycleItems={false}
        contentContainerStyle={{ paddingHorizontal: grid.margin, paddingBottom: SECTION_GAP }}
        ListHeaderComponent={
          <View>
            <Text className="pb-3 font-sans text-footnote text-secondary">
              {strings.settings.dislikedSongsAreLeftOut}
            </Text>
            <Hairline />
          </View>
        }
        ListEmptyComponent={
          songs === null ? null : (
            <Text className="py-3 font-sans text-body text-secondary">
              {strings.settings.youHaventDislikedAnySongs}
            </Text>
          )
        }
      />
    </SettingsEditorScreen>
  );
}
