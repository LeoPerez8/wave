import * as Haptics from "expo-haptics";
import { useRef, type ComponentRef, type ReactNode } from "react";
import {
  Pressable,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type View,
  type ViewStyle,
} from "react-native";
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

import { runPressedAt } from "./pressedRect";

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
  /** Its tap opens a menu, which floats next to it (`pressedRect`), as long-press menus do. */
  opensMenu?: boolean;
};

type Handler = PressableProps["onLongPress"];

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
  onPress,
  onLongPress,
  opensMenu = false,
  children,
  ...rest
}: Props) {
  const ms = useTapAnimationMs();
  const reduceMotion = useReducedMotion();
  const pressed = useSharedValue(0);
  const view = useRef<ComponentRef<typeof View>>(null);

  // Long-presses open menus: measure where this sits first, so the menu can float next to it.
  const anchored = (handler: Handler): ((event: GestureResponderEvent) => void) | undefined =>
    handler == null
      ? undefined
      : (event) => {
          const node = view.current;
          if (node === null || typeof node.measureInWindow !== "function") {
            runPressedAt(undefined, () => handler(event));
            return;
          }
          node.measureInWindow((x, y, width, height) =>
            runPressedAt(
              width > 0 ? { left: x, top: y, right: x + width, bottom: y + height } : undefined,
              () => handler(event),
            ),
          );
        };

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
      ref={view}
      onPress={opensMenu ? anchored(onPress) : onPress}
      onLongPress={anchored(onLongPress)}
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
