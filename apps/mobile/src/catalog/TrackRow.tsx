import { IconFileOff, IconStarFilled } from "@tabler/icons-react-native";
import { Text, View, type PressableProps as PressProps } from "react-native";

import { Press } from "@/motion/Press";
import { useThemeColor } from "@/theme/useThemeColor";

import { Artwork } from "./Artwork";
import { CELL, grid } from "./grid";
import { RankNumber } from "./RankNumber";
import { WavyUnderline } from "./WavyUnderline";

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
  /** Sets the number in ember: the top entry of a ranking, whose number is its rank. */
  topNumber?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  /** Screen-reader actions standing in for gestures (move, remove in a playlist). */
  accessibilityActions?: PressProps["accessibilityActions"];
  onAccessibilityAction?: PressProps["onAccessibilityAction"];
};

export const formatDuration = (ms: number): string => {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

const THUMB = CELL * 5;

/**
 * A track: leading thumbnail or track number, title over artist, then the
 * favorite cell and the duration. The playing track's title is in ember with a
 * wavy underline under its visible text. A missing file shows its icon (in
 * place of the number in numbered lists, trailing in artwork lists). Title and
 * artist share one size; rank is weight and tint.
 */
export function TrackRow({
  track,
  state,
  favorite = false,
  leading,
  topNumber = false,
  onPress,
  onLongPress,
  accessibilityActions,
  onAccessibilityAction,
}: Props) {
  const highlight = useThemeColor("highlight");
  const tertiary = useThemeColor("tertiary");
  const missing = state === "missing";
  const playing = state === "playing";
  const missingIcon = <IconFileOff size={18} color={tertiary} strokeWidth={1.5} />;

  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={`${track.title}, ${track.artist}${playing ? ", now playing" : ""}`}
      accessibilityState={{ disabled: missing, selected: playing }}
      disabled={missing}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={onAccessibilityAction}
      depth={0.015}
    >
      <View className="flex-row items-center" style={{ height: grid.row, gap: CELL * 1.5 }}>
        {leading === "artwork" ? (
          <Artwork uri={track.artworkUri} tint={track.tint} size={THUMB} />
        ) : !missing && track.trackNumber !== undefined ? (
          <RankNumber rank={track.trackNumber} top={topNumber} />
        ) : (
          <View className="items-center" style={{ width: grid.stateCell }}>
            {missing && missingIcon}
          </View>
        )}
        <View className="flex-1">
          {/* Hugs the title's visible (possibly truncated) text, so the underline spans just that. */}
          <View style={{ alignSelf: "flex-start", maxWidth: "100%" }}>
            <Text
              numberOfLines={1}
              className={`font-sans text-body font-medium ${
                playing ? "text-highlight" : missing ? "text-secondary" : "text-foreground"
              }`}
            >
              {track.title}
            </Text>
            {playing && <WavyUnderline />}
          </View>
          <Text numberOfLines={1} className="font-sans text-body text-secondary">
            {missing ? "File not found" : track.artist}
          </Text>
        </View>
        {leading === "artwork" && missing && (
          <View className="items-center" style={{ width: CELL * 3 }}>
            {missingIcon}
          </View>
        )}
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
