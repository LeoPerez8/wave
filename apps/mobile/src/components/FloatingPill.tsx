import type { Icon } from "@tabler/icons-react-native";
import { type ComponentProps, type ReactNode } from "react";
import { Text } from "react-native";
import Animated, { FadeIn, FadeOut, ReduceMotion, useReducedMotion } from "react-native-reanimated";

import { CELL } from "@/catalog/grid";
import { TextButton } from "@/components/TextButton";
import { useListPillOnScreen } from "@/components/listPills";
import { TAP_ANIMATION_MS } from "@/motion/timing";

/** The pill's height. */
const PILL = CELL * 6;
/** The room a pill takes over a list's bottom, so the last row can scroll clear of it. */
export const FLOATING_PILL_ROOM = PILL + CELL;

const pillIn = FadeIn.duration(TAP_ANIMATION_MS).reduceMotion(ReduceMotion.Never);
const pillOut = FadeOut.duration(TAP_ANIMATION_MS).reduceMotion(ReduceMotion.Never);

type PillProps = {
  icon: Icon;
  label: string;
  accessibilityLabel?: string;
  bottom: number;
  onPress: () => void;
  accessibilityActions?: ComponentProps<typeof TextButton>["accessibilityActions"];
  onAccessibilityAction?: ComponentProps<typeof TextButton>["onAccessibilityAction"];
  /** Wraps the button, for a pill that also takes a gesture. */
  wrapButton?: (button: ReactNode) => ReactNode;
};

/**
 * A pill over a screen's list, which the update pill waits for while that screen is in front (a
 * playlist's Go to Suggestions). It has to sit inside a navigator's screen.
 */
export function FloatingPill(props: Pick<PillProps, "icon" | "label" | "bottom" | "onPress">) {
  useListPillOnScreen();
  return <FloatingPillLook {...props} />;
}

/**
 * A pill floating, [bottom] up, that holds nothing back: the Queue's Current Song, which only shows
 * in Now Playing where the update pill is already hidden, and the update pill itself. It fades in and
 * out with the tap animation, or just appears and goes under reduce motion. [accessibilityLabel] is
 * what a screen reader hears, when not the [label].
 */
export function FloatingPillLook({
  icon: Arrow,
  label,
  accessibilityLabel = label,
  bottom,
  onPress,
  accessibilityActions,
  onAccessibilityAction,
  wrapButton = (button) => button,
}: PillProps) {
  const reduceMotion = useReducedMotion();
  return (
    <Animated.View
      entering={reduceMotion ? undefined : pillIn}
      exiting={reduceMotion ? undefined : pillOut}
      pointerEvents="box-none"
      className="absolute left-0 right-0 items-center"
      style={{ bottom }}
    >
      {wrapButton(
        <TextButton
          variant="pill"
          label={label}
          accessibilityLabel={accessibilityLabel}
          accessibilityActions={accessibilityActions}
          onAccessibilityAction={onAccessibilityAction}
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
        </TextButton>,
      )}
    </Animated.View>
  );
}
