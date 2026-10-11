import { Text, View } from "react-native";

import { Press } from "@/motion/Press";

import { grid } from "./grid";

type Props = {
  name: string;
  /** The quiet second line: counts, a path. */
  detail: string;
  onPress: () => void;
  onLongPress?: () => void;
};

/**
 * An artist, genre or folder in a list: the name over a graphite detail line,
 * at one size like a track row, 56dp so long lists lay out by index.
 */
export function NameRow({ name, detail, onPress, onLongPress }: Props) {
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${detail}`}
      onPress={onPress}
      onLongPress={onLongPress}
      haptic="selection"
      depth={0.015}
    >
      <View className="justify-center" style={{ height: grid.row }}>
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
    </Press>
  );
}
