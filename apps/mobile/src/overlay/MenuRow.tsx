import { Text, View } from "react-native";

import { CELL, grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { Press } from "@/motion/Press";
import { ACTION_ICONS, type ActionIcon, type MenuAction } from "@/playback/actionIcons";
import { useThemeColor } from "@/theme/useThemeColor";

/** A menu row's icon: a Tabler line icon a little taller than the Body label beside it. */
const ICON_SIZE = 22;
const ICON_STROKE = 1.75;

type Props = {
  /** What the row does: it picks the row's icon (`ACTION_ICONS`), the same in every menu. */
  action: MenuAction;
  /** Draws another icon than the action's (Shuffle's follows the shuffle kind chosen). */
  icon?: ActionIcon | undefined;
  label: string;
  onPress: () => void;
  /** The hairline under the row; the one at the card's edge goes without (Core `entryDivider`). */
  divider?: boolean;
  /** Looks pressed: the row a finger sliding across its menu would run. */
  highlighted?: boolean;
  /** Deletes something for good: the icon and label in the destructive colour. */
  destructive?: boolean;
};

/**
 * One row of a long-press menu's list: the action's icon, then its label in
 * the list text size (Body, as a song row's title), both in the row's text
 * colour. At least a list row tall, taller where large text or a wrapping
 * label needs it.
 */
export function MenuRow({
  action,
  icon,
  label,
  onPress,
  divider = true,
  highlighted = false,
  destructive = false,
}: Props) {
  // The icon's colour is a native prop; the label takes the same token as a class.
  const tone = useThemeColor(destructive ? "destructive" : "foreground");
  const Icon = icon ?? ACTION_ICONS[action];
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      haptic="selection"
      highlighted={highlighted}
    >
      <View className="flex-row items-center" style={{ minHeight: grid.row, gap: CELL * 1.5 }}>
        <Icon size={ICON_SIZE} color={tone} strokeWidth={ICON_STROKE} />
        <Text
          className={`flex-1 font-sans text-body ${destructive ? "text-destructive" : "text-foreground"}`}
          style={{ paddingVertical: CELL / 2 }}
        >
          {label}
        </Text>
      </View>
      {divider && <Hairline />}
    </Press>
  );
}
