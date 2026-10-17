import { Text, View, type PressableProps } from "react-native";

import { Press } from "@/motion/Press";

import { TileCheck } from "./CheckCell";
import { Mosaic } from "./Mosaic";
import { PLAYLIST_CAPTION } from "./playlistTileSize";

// Each caption line keeps its place, so every tile (and row) is the same height.
const { top: CAPTION_TOP, line: CAPTION_LINE } = PLAYLIST_CAPTION;

type Props = {
  name: string;
  /** The song count under the name (grid tiles); large cards show the name alone. */
  detail?: string | undefined;
  /** Mosaic covers (none, one or four). */
  paths: readonly string[];
  /** The cover's side, in dp. */
  size: number;
  /** Words for screen readers when [detail] isn't shown, e.g. the song count. */
  accessibilityDetail: string;
  onPress: () => void;
  onLongPress?: (() => void) | undefined;
  /**
   * In selection mode, whether the tile is checked: its cover shows a check in
   * the corner. Undefined outside selection mode.
   */
  checked?: boolean | undefined;
  /** Actions for screen readers beyond a tap and a long press (Move up, Move down). */
  accessibilityActions?: PressableProps["accessibilityActions"];
  onAccessibilityAction?: PressableProps["onAccessibilityAction"];
  /** Room kept clear at the end of the name's line, in dp, for what sits over it (a drag handle). */
  nameInset?: number | undefined;
};

/**
 * A playlist as a tile: its cover (the playlist's artwork, `Mosaic`) at
 * [size], the name under it, and the count when given. A grid's tiles and the
 * large cards are both this, at different sizes.
 */
export function PlaylistTile({
  name,
  detail,
  paths,
  size,
  accessibilityDetail,
  onPress,
  onLongPress,
  checked,
  accessibilityActions,
  onAccessibilityAction,
  nameInset,
}: Props) {
  const selecting = checked !== undefined;
  return (
    <Press
      accessibilityRole={selecting ? "checkbox" : "button"}
      accessibilityLabel={`${name}, ${accessibilityDetail}`}
      accessibilityState={selecting ? { checked } : undefined}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={onAccessibilityAction}
      haptic="selection"
      depth={0.02}
      style={{ width: size }}
    >
      <View>
        <Mosaic paths={paths} size={size} />
        {selecting && <TileCheck checked={checked} />}
      </View>
      <View style={{ paddingTop: CAPTION_TOP }}>
        <Text
          numberOfLines={1}
          className="font-sans text-body font-medium text-foreground"
          style={{ height: CAPTION_LINE, paddingRight: nameInset }}
        >
          {name}
        </Text>
        {detail !== undefined && (
          <Text
            numberOfLines={1}
            className="font-sans text-body text-secondary"
            style={{ height: CAPTION_LINE, fontVariant: ["tabular-nums"] }}
          >
            {detail}
          </Text>
        )}
      </View>
    </Press>
  );
}
