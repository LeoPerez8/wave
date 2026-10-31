import type { Icon } from "@tabler/icons-react-native";
import { Text } from "react-native";
import Animated, { FadeIn, FadeOut, ReduceMotion, useReducedMotion } from "react-native-reanimated";

import { CELL } from "@/catalog/grid";
import { TextButton } from "@/components/TextButton";
import { TAP_ANIMATION_MS } from "@/motion/timing";

/** The pill's height. */
const PILL = CELL * 6;
/** The room a pill takes over a list's bottom, so the last row can scroll clear of it. */
export const FLOATING_PILL_ROOM = PILL + CELL;

const pillIn = FadeIn.duration(TAP_ANIMATION_MS).reduceMotion(ReduceMotion.Never);
const pillOut = FadeOut.duration(TAP_ANIMATION_MS).reduceMotion(ReduceMotion.Never);

/**
 * A pill floating over a list's bottom, [bottom] up, that takes the list somewhere
 * out of sight (the Queue's Current Song, a playlist's Go to Suggestions). It fades
 * in and out with the tap animation, or just appears and goes under reduce motion.
 * [accessibilityLabel] is what a screen reader hears, when not the [label].
 */
export function FloatingPill({
  icon: Arrow,
  label,
  accessibilityLabel = label,
  bottom,
  onPress,
}: {
  icon: Icon;
  label: string;
  accessibilityLabel?: string;
  bottom: number;
  onPress: () => void;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <Animated.View
      entering={reduceMotion ? undefined : pillIn}
      exiting={reduceMotion ? undefined : pillOut}
      pointerEvents="box-none"
      className="absolute left-0 right-0 items-center"
      style={{ bottom }}
    >
      <TextButton
        variant="pill"
        label={label}
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        className="flex-row items-center"
        style={{ minHeight: PILL, gap: CELL }}
      >
        {(color) => (
          <>
            <Arrow size={16} color={color} strokeWidth={2} />
            <Text className="font-sans text-subheadline font-semibold" style={{ color }}>
              {label}
            </Text>
          </>
        )}
      </TextButton>
    </Animated.View>
  );
}
