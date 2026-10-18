import * as Haptics from "expo-haptics";
import { Pressable, Text, type PressableStateCallbackType } from "react-native";

type Props = {
  label: string;
  onPress: () => void;
  /** What a screen reader says, when the label alone doesn't (Remove, but from what). */
  accessibilityLabel?: string;
  /** `destructive` for an action that deletes or removes something. */
  tone?: "accent" | "destructive";
};

const TONE = { accent: "text-accent", destructive: "text-destructive" } as const;

/** Dims while pressed: a plain style, no animated one. */
const pressedStyle = ({ pressed }: PressableStateCallbackType) => ({
  minHeight: 48,
  justifyContent: "center" as const,
  opacity: pressed ? 0.4 : 1,
});

/**
 * `TextButton` for the rows of a long virtualized list (Settings › Downloads): the same label in
 * a 48dp target, dimmed while pressed instead of `Press`'s animation. Each row carrying its own
 * animated style makes Reanimated re-apply its whole registry on the main thread for every layout
 * event, which froze the page with hundreds of rows (#446).
 */
export function PlainTextButton({ label, onPress, accessibilityLabel, tone = "accent" }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={() => {
        void Haptics.selectionAsync();
        onPress();
      }}
      style={pressedStyle}
    >
      <Text className={`font-sans text-body font-medium ${TONE[tone]}`}>{label}</Text>
    </Pressable>
  );
}
