import { Text, View } from "react-native";

import { grid } from "./grid";

/**
 * A ranking's number cell, as a numbered track row lays it out: graphite
 * tabular figures, the top entry in ember.
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
