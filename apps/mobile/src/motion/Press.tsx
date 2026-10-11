import * as Haptics from "expo-haptics";
import type { ReactNode } from "react";
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import {
  createAnimatedComponent,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { withUniwind } from "uniwind";

import { useTapAnimationMs } from "@/settings/tapAnimation";

const AnimatedPressable = withUniwind(createAnimatedComponent(Pressable));

/** Ease-out exponential: fast to respond, quiet to settle. */
const EASE = Easing.out(Easing.exp);

type Props = Omit<PressableProps, "children" | "style"> & {
  className?: string;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
  /** Haptic on press: `selection` for light taps, `impact` for actions like play/favorite. */
  haptic?: "selection" | "impact";
  /** How far the target sinks on press; large tiles sink less than small buttons. */
  depth?: number;
};

/**
 * Every tappable thing in Wave. The press animation takes the duration set in
 * Settings (tap animation, in ms); 0 or the system's reduce-motion setting
 * makes it an instant dim instead.
 */
export function Press({
  haptic,
  depth = 0.04,
  style: staticStyle,
  onPressIn,
  onPressOut,
  children,
  ...rest
}: Props) {
  const ms = useTapAnimationMs();
  const reduceMotion = useReducedMotion();
  const pressed = useSharedValue(0);

  const pressStyle = useAnimatedStyle(() => ({
    opacity: 1 - pressed.get() * 0.35,
    transform: [{ scale: reduceMotion ? 1 : 1 - pressed.get() * depth }],
  }));

  const animateTo = (value: number) => {
    pressed.set(ms === 0 ? value : withTiming(value, { duration: ms, easing: EASE }));
  };

  return (
    <AnimatedPressable
      {...rest}
      style={[staticStyle, pressStyle]}
      onPressIn={(event) => {
        animateTo(1);
        if (haptic === "selection") void Haptics.selectionAsync();
        if (haptic === "impact") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        animateTo(0);
        onPressOut?.(event);
      }}
    >
      {children}
    </AnimatedPressable>
  );
}
