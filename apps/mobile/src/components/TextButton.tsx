import { Text } from "react-native";

import { CELL } from "@/catalog/grid";
import { Press } from "@/motion/Press";

type Props = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** `destructive` for an action that deletes or removes something. */
  tone?: "accent" | "destructive";
  /** It opens a card, and stays highlighted while the card is open. */
  opensMenu?: boolean;
};

const TONE = { accent: "text-accent", destructive: "text-destructive" } as const;

/**
 * Room either side of the label of a button that opens a card, so its highlight
 * doesn't end at the first and last letter. A negative margin as wide keeps the
 * label where it was.
 */
const MENU_INSET = { paddingHorizontal: CELL * 1.5, marginHorizontal: -CELL * 1.5 } as const;

/** A text-only action in the accent tone: no container, a 48dp target. */
export function TextButton({
  label,
  onPress,
  disabled = false,
  tone = "accent",
  opensMenu = false,
}: Props) {
  return (
    <Press
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      opensMenu={opensMenu}
      haptic="selection"
      className="justify-center"
      style={[{ minHeight: 48 }, opensMenu && MENU_INSET]}
    >
      <Text
        className={`font-sans text-body font-medium ${disabled ? "text-secondary" : TONE[tone]}`}
      >
        {label}
      </Text>
    </Press>
  );
}
