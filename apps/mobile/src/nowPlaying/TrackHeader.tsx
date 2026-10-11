import { Text, View } from "react-native";

import { Artwork } from "@/catalog/Artwork";
import { CELL, grid } from "@/catalog/grid";
import type { PlaybackState } from "@/playback/Player";

/**
 * What's playing, small: the artwork, title and artist in one row. Tops the
 * Queue and Lyrics views, which take the space the big artwork had.
 */
export function TrackHeader({ item }: { item: NonNullable<PlaybackState["item"]> }) {
  return (
    <View
      className="flex-row items-center"
      style={{ height: grid.row + CELL * 2, gap: CELL * 1.5 }}
    >
      <Artwork uri={item.artworkUri ?? undefined} size={grid.row} />
      <View className="flex-1">
        <Text numberOfLines={1} className="font-sans text-body font-medium text-foreground">
          {item.title ?? "Unknown title"}
        </Text>
        <Text numberOfLines={1} className="font-sans text-body text-secondary">
          {item.artist ?? "Unknown Artist"}
        </Text>
      </View>
    </View>
  );
}
