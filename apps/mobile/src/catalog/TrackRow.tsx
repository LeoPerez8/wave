import { IconFileOff, IconStarFilled } from "@tabler/icons-react-native";
import { Text, View, type PressableProps as PressProps } from "react-native";

import { Press } from "@/motion/Press";
import { useThemeColor } from "@/theme/useThemeColor";

import { Artwork } from "./Artwork";
import { CheckCell } from "./CheckCell";
import { CELL, grid } from "./grid";
import { RankNumber } from "./RankNumber";
import { WavyUnderline } from "./WavyUnderline";

export type TrackSummary = {
  id: string;
  title: string;
  artist: string;
  /** Null when unknown (a YT Music song that doesn't say); the cell stays reserved. */
  durationMs: number | null;
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
  /**
   * In selection mode, whether the row is checked: it shows a leading check
   * cell and reads as a checkbox. Undefined outside selection mode.
   */
  checked?: boolean | undefined;
  /**
   * How much of a download has arrived (0–1): a thin teal rule under the
   * title and second line, filling up. Undefined (or null) shows none.
   */
  progress?: number | null | undefined;
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
 * artist share one size; rank is weight and tint. In selection mode a check
 * cell leads the row.
 */
export function TrackRow({
  track,
  state,
  favorite = false,
  leading,
  topNumber = false,
  checked,
  progress,
  onPress,
  onLongPress,
  accessibilityActions,
  onAccessibilityAction,
}: Props) {
  const highlight = useThemeColor("highlight");
  const tertiary = useThemeColor("tertiary");
  const missing = state === "missing";
  const playing = state === "playing";
  const selecting = checked !== undefined;
  const missingIcon = <IconFileOff size={18} color={tertiary} strokeWidth={1.5} />;

  return (
    <Press
      accessibilityRole={selecting ? "checkbox" : "button"}
      accessibilityLabel={`${track.title}, ${track.artist}${playing ? ", now playing" : ""}`}
      accessibilityState={
        selecting ? { disabled: missing, checked } : { disabled: missing, selected: playing }
      }
      disabled={missing}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={onAccessibilityAction}
      depth={0.015}
    >
      <View className="flex-row items-center" style={{ height: grid.row, gap: CELL * 1.5 }}>
        {selecting && <CheckCell checked={checked} />}
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
          {progress !== undefined && progress !== null && (
            <View className="bg-separator" style={{ height: 2, marginTop: CELL / 2 }}>
              <View
                className="bg-accent"
                style={{ height: 2, width: `${Math.round(progress * 100)}%` }}
              />
            </View>
          )}
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
          {track.durationMs === null ? "" : formatDuration(track.durationMs)}
        </Text>
      </View>
    </Press>
  );
}
