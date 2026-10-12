import { Text, View } from "react-native";

import { Press } from "@/motion/Press";

import { grid } from "./grid";
import { Hairline } from "./Hairline";

type Props = {
  label: string;
  /** Item count, when known; the column stays reserved either way. */
  count?: number | undefined;
  onPress: () => void;
  /** The hairline under the entry; the last entry in a card goes without. */
  divider?: boolean;
};

/** A Library entry (Playlists, Artists, …): one quiet line of type, no icon, no chevron. */
export function EntryRow({ label, count, onPress, divider = true }: Props) {
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={count === undefined ? label : `${label}, ${count.toLocaleString("en")}`}
      onPress={onPress}
      haptic="selection"
    >
      <View className="flex-row items-center" style={{ height: grid.row }}>
        <Text className="flex-1 font-sans text-title3 font-normal text-foreground">{label}</Text>
        <Text
          className="font-sans text-subheadline text-secondary"
          style={{ fontVariant: ["tabular-nums"] }}
        >
          {count === undefined ? "" : count.toLocaleString("en")}
        </Text>
      </View>
      {divider && <Hairline />}
    </Press>
  );
}
