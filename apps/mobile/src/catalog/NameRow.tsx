import { Text, View } from "react-native";

import { Press } from "@/motion/Press";

import { CELL, grid } from "./grid";
import { RankNumber } from "./RankNumber";

type Props = {
  name: string;
  /** The quiet second line: counts, a path. */
  detail: string;
  onPress: () => void;
  onLongPress?: () => void;
  /** In a ranking: the entry's rank, shown leading (the top one in ember). */
  rank?: { readonly number: number; readonly top: boolean } | undefined;
};

/**
 * An artist, genre or folder in a list: the name over a graphite detail line,
 * at one size like a track row, 56dp so long lists lay out by index.
 */
export function NameRow({ name, detail, onPress, onLongPress, rank }: Props) {
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${detail}`}
      onPress={onPress}
      onLongPress={onLongPress}
      haptic="selection"
      depth={0.015}
    >
      <View className="flex-row items-center" style={{ height: grid.row, gap: CELL * 1.5 }}>
        {rank !== undefined && <RankNumber rank={rank.number} top={rank.top} />}
        <View className="flex-1 justify-center">
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
