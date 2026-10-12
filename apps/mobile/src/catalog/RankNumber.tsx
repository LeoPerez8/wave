import { Text, View } from "react-native";

import { grid } from "./grid";

/**
 * The number cell of a numbered row (a track number, or a ranking's number):
 * graphite tabular figures, the top entry of a ranking in ember.
 */
export function RankNumber({ rank, top }: { rank: number; top: boolean }) {
  return (
    <View className="items-center" style={{ width: grid.stateCell }}>
      <Text
        className={`font-sans text-body ${top ? "font-medium text-highlight" : "text-secondary"}`}
        style={{ fontVariant: ["tabular-nums"] }}
      >
        {rank}
      </Text>
    </View>
  );
}
