import { IconPlayerPauseFilled, IconPlayerPlayFilled } from "@tabler/icons-react-native";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Artwork } from "@/catalog/Artwork";
import { CELL, grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { IconButton } from "@/components/IconButton";

import { togglePlayPause } from "./actions";
import { usePlayback } from "./hooks";

type Props = {
  /** Pad for the bottom system inset when nothing below the mini player does (pushed screens). */
  inset?: boolean;
};

/**
 * The current track with play/pause and a position line. Flat for now; the
 * floating mini player (#8) and Now Playing (#9) build on it.
 */
export function MiniPlayer({ inset = false }: Props) {
  const playback = usePlayback();
  const insets = useSafeAreaInsets();
  const { item } = playback;
  if (item === null) return null;

  const fraction =
    playback.durationMs !== null && playback.durationMs > 0
      ? Math.min(1, playback.positionMs / playback.durationMs)
      : 0;
  const title = item.title ?? "Unknown title";
  const playing = playback.playWhenReady;

  return (
    <View className="bg-background" style={{ paddingBottom: inset ? insets.bottom : 0 }}>
      <Hairline />
      <View
        className="flex-row items-center"
        style={{
          height: grid.row + CELL,
          gap: CELL * 1.5,
          paddingLeft: grid.margin,
          paddingRight: grid.margin - 12,
        }}
      >
        <Artwork uri={item.artworkUri ?? undefined} size={CELL * 5} />
        <View className="flex-1">
          <Text numberOfLines={1} className="font-sans text-body font-medium text-foreground">
            {title}
          </Text>
          <Text numberOfLines={1} className="font-sans text-body text-secondary">
            {playback.error === null
              ? (item.artist ?? "Unknown Artist")
              : "Couldn't play this file"}
          </Text>
        </View>
        <IconButton
          icon={playing ? IconPlayerPauseFilled : IconPlayerPlayFilled}
          label={playing ? `Pause ${title}` : `Play ${title}`}
          onPress={togglePlayPause}
        />
      </View>
      <View
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: Math.round(fraction * 100) }}
        className="bg-separator"
        style={{ height: CELL / 4, marginHorizontal: grid.margin }}
      >
        <View className="bg-accent" style={{ height: CELL / 4, width: `${fraction * 100}%` }} />
      </View>
      <View style={{ height: CELL }} />
    </View>
  );
}
