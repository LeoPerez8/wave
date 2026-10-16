import { IconCheck } from "@tabler/icons-react-native";
import { Text, View } from "react-native";

import { Press } from "@/motion/Press";
import { useThemeColor } from "@/theme/useThemeColor";

import { CELL, grid } from "./grid";
import { Hairline } from "./Hairline";

type Props = {
  label: string;
  /** Item count, when known; the column stays reserved either way. */
  count?: number | undefined;
  onPress: () => void;
  /** Opens the entry's menu, where it has one. */
  onLongPress?: (() => void) | undefined;
  /** The hairline under the entry; the last entry in a card goes without. */
  divider?: boolean;
  /** Looks pressed: the entry a finger sliding across its menu would run. */
  highlighted?: boolean;
  /** The current choice among the card's entries (a sort): marked with a check. */
  selected?: boolean;
  /** Deletes something (a song's file): the label in the destructive colour. */
  destructive?: boolean;
};

/** A Library entry (Playlists, Artists, …): one quiet line of type, no icon, no chevron. */
export function EntryRow({
  label,
  count,
  onPress,
  onLongPress,
  divider = true,
  highlighted = false,
  selected = false,
  destructive = false,
}: Props) {
  const accent = useThemeColor("accent");
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={count === undefined ? label : `${label}, ${count.toLocaleString("en")}`}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityState={{ selected }}
      haptic="selection"
      highlighted={highlighted}
    >
      {/* At least a row tall, taller where large text or a wrapping label needs it. */}
      <View className="flex-row items-center" style={{ minHeight: grid.row }}>
        <Text
          className={`flex-1 font-sans text-title3 font-normal ${destructive ? "text-destructive" : "text-foreground"}`}
          style={{ paddingVertical: CELL / 2 }}
        >
          {label}
        </Text>
        {selected ? (
          <IconCheck size={22} color={accent} strokeWidth={1.75} />
        ) : (
          <Text
            className="font-sans text-subheadline text-secondary"
            style={{ fontVariant: ["tabular-nums"] }}
          >
            {count === undefined ? "" : count.toLocaleString("en")}
          </Text>
        )}
      </View>
      {divider && <Hairline />}
    </Press>
  );
}
