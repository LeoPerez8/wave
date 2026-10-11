import { Text } from "react-native";

import { Press } from "@/motion/Press";

type Props = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
};

/** A text-only action in the accent tone: no container, a 48dp target. */
export function TextButton({ label, onPress, disabled = false }: Props) {
  return (
    <Press
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      haptic="selection"
      className="justify-center"
      style={{ minHeight: 48 }}
    >
      <Text
        className={`font-sans text-body font-medium ${disabled ? "text-secondary" : "text-accent"}`}
      >
        {label}
      </Text>
    </Press>
  );
}
