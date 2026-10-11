import { Text } from "react-native";

import { Press } from "@/motion/Press";

type Props = {
  label: string;
  onPress: () => void;
};

/** A text-only action in the accent tone: no container, a 48dp target. */
export function TextButton({ label, onPress }: Props) {
  return (
    <Press
      accessibilityRole="button"
      onPress={onPress}
      haptic="selection"
      className="justify-center"
      style={{ minHeight: 48 }}
    >
      <Text className="font-sans text-body font-medium text-accent">{label}</Text>
    </Press>
  );
}
