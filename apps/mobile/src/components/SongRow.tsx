import { IconMusic } from "@tabler/icons-react-native";
import { Image } from "expo-image";
import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";

import type { SongRow as Song } from "@/library/LibraryStore";
import { useThemeColor } from "@/theme/useThemeColor";

export const SONG_ROW_HEIGHT = 64;
const ARTWORK_SIZE = 48;

/** A track row: thumbnail, title and artist, with an inset separator. */
export const SongRow = memo(function SongRow({ song }: { song: Song }) {
  const tertiary = useThemeColor("tertiary");
  const separator = useThemeColor("separator");
  const fill = useThemeColor("fill");

  return (
    <View className="flex-row items-center gap-3 px-5" style={{ height: SONG_ROW_HEIGHT }}>
      {song.thumbPath ? (
        <Image
          source={{ uri: `file://${song.thumbPath}` }}
          // Rows are recycled; the key stops the previous song's artwork flashing.
          recyclingKey={song.path}
          style={[styles.artwork, { backgroundColor: fill }]}
          contentFit="cover"
          transition={120}
        />
      ) : (
        <View style={[styles.artwork, styles.placeholder, { backgroundColor: fill }]}>
          <IconMusic size={22} color={tertiary} strokeWidth={1.5} />
        </View>
      )}
      <View
        className="flex-1 justify-center self-stretch"
        style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: separator }}
      >
        <Text numberOfLines={1} className="font-sans text-body text-foreground">
          {song.title}
        </Text>
        <Text numberOfLines={1} className="font-sans text-subheadline text-secondary">
          {song.artist}
        </Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  artwork: { width: ARTWORK_SIZE, height: ARTWORK_SIZE, borderRadius: 6 },
  placeholder: { alignItems: "center", justifyContent: "center" },
});
