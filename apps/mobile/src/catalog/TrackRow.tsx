import { IconFileOff, IconStarFilled, IconVolume } from "@tabler/icons-react-native";
import { Text, View } from "react-native";

import { Press } from "@/motion/Press";
import { useThemeColor } from "@/theme/useThemeColor";

import { Artwork } from "./Artwork";
import { CELL, grid } from "./grid";

export type TrackSummary = {
  id: string;
  title: string;
  artist: string;
  durationMs: number;
  trackNumber?: number | undefined;
  artworkUri?: string | undefined;
  tint?: string | undefined;
};

export type TrackState = "playing" | "missing" | undefined;

type Props = {
  track: TrackSummary;
  state?: TrackState;
  favorite?: boolean;
  /** Songs lists show a thumbnail; album track lists show the track number. */
  leading: "artwork" | "number";
  onPress: () => void;
  onLongPress?: () => void;
};

export const formatDuration = (ms: number): string => {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

const THUMB = CELL * 5;

/**
 * A track. Every row reserves the same fixed cells, so state never shifts the
 * layout: the state cell (number / playing / missing), the favorite cell and
 * the duration. Title and artist share one size; rank is weight and tint.
 */
export function TrackRow({ track, state, favorite = false, leading, onPress, onLongPress }: Props) {
  const highlight = useThemeColor("highlight");
  const tertiary = useThemeColor("tertiary");
  const missing = state === "missing";

  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={`${track.title}, ${track.artist}`}
      accessibilityState={{ disabled: missing, selected: state === "playing" }}
      disabled={missing}
      onPress={onPress}
      onLongPress={onLongPress}
      depth={0.015}
    >
      <View className="flex-row items-center" style={{ height: grid.row, gap: CELL * 1.5 }}>
        {leading === "artwork" && <Artwork uri={track.artworkUri} tint={track.tint} size={THUMB} />}
        <View className="items-center" style={{ width: grid.stateCell, marginLeft: -CELL }}>
          {state === "playing" ? (
            <IconVolume size={18} color={highlight} strokeWidth={1.75} />
          ) : missing ? (
            <IconFileOff size={18} color={tertiary} strokeWidth={1.5} />
          ) : leading === "number" && track.trackNumber !== undefined ? (
            <Text
              className="font-sans text-body text-secondary"
              style={{ fontVariant: ["tabular-nums"] }}
            >
              {track.trackNumber}
            </Text>
          ) : null}
        </View>
        <View className="flex-1">
          <Text
            numberOfLines={1}
            className={`font-sans text-body font-medium ${
              state === "playing"
                ? "text-highlight"
                : missing
                  ? "text-secondary"
                  : "text-foreground"
            }`}
          >
            {track.title}
          </Text>
          <Text numberOfLines={1} className="font-sans text-body text-secondary">
            {missing ? "File not found" : track.artist}
          </Text>
        </View>
        <View className="items-center" style={{ width: CELL * 3 }}>
          {favorite && <IconStarFilled size={14} color={highlight} />}
        </View>
        <Text
          className="font-sans text-footnote text-secondary"
          style={{ fontVariant: ["tabular-nums"], width: CELL * 5, textAlign: "right" }}
        >
          {formatDuration(track.durationMs)}
        </Text>
      </View>
    </Press>
  );
}
