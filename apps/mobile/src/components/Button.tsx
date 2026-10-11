import { Pressable, Text } from "react-native";

type Props = {
  label: string;
  onPress: () => void;
  /** `filled` for the main action of a screen, `plain` for secondary ones. */
  variant?: "filled" | "plain";
};

export function Button({ label, onPress, variant = "filled" }: Props) {
  const filled = variant === "filled";
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className={
        filled
          ? "items-center rounded-full bg-accent px-6 py-3 active:opacity-80"
          : "items-center rounded-full px-4 py-2 active:opacity-60"
      }
    >
      <Text
        className={
          filled
            ? "font-sans text-body font-semibold text-white"
            : "font-sans text-body font-semibold text-accent"
        }
      >
        {label}
      </Text>
    </Pressable>
  );
}
