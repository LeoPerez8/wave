import { Text } from "react-native";

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
      style={{ minHeight: 48 }}
    >
      <Text
        className={`font-sans text-body font-medium ${disabled ? "text-secondary" : TONE[tone]}`}
      >
        {label}
      </Text>
    </Press>
  );
}
