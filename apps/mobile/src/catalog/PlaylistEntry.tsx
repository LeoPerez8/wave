import { Text, View } from "react-native";

import { Press } from "@/motion/Press";

import { CheckCell } from "./CheckCell";
import { CELL, grid } from "./grid";
import { Mosaic } from "./Mosaic";

type Props = {
  name: string;
  /** The quiet second line: the song count. */
  detail: string;
  /** Mosaic thumbnails (none, one or four). */
  paths: readonly string[];
  onPress: () => void;
  onLongPress?: (() => void) | undefined;
  /**
   * In selection mode, whether the row is checked: it shows a leading check
   * cell. Undefined outside selection mode.
   */
  checked?: boolean | undefined;
};

/** A playlist in a list: its mosaic as a 40dp thumbnail, the name over a graphite count. */
export function PlaylistEntry({ name, detail, paths, onPress, onLongPress, checked }: Props) {
  const selecting = checked !== undefined;
  return (
    <Press
      accessibilityRole={selecting ? "checkbox" : "button"}
      accessibilityLabel={`${name}, ${detail}`}
      accessibilityState={selecting ? { checked } : undefined}
      onPress={onPress}
      onLongPress={onLongPress}
      haptic="selection"
      depth={0.015}
    >
      <View className="flex-row items-center" style={{ height: grid.row, gap: CELL * 1.5 }}>
        {selecting && <CheckCell checked={checked} />}
        <Mosaic paths={paths} size={CELL * 5} />
        <View className="flex-1">
          <Text numberOfLines={1} className="font-sans text-body font-medium text-foreground">
            {name}
          </Text>
          <Text
            numberOfLines={1}
            className="font-sans text-body text-secondary"
            style={{ fontVariant: ["tabular-nums"] }}
          >
            {detail}
          </Text>
        </View>
      </View>
    </Press>
  );
}
