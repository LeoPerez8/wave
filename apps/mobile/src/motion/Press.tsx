import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState, type ComponentRef, type ReactNode } from "react";
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

import { useIsOverlayOrigin } from "@/overlay/overlay";
import { useLongPressDelayMs } from "@/settings/longPressDelay";
import { useTapAnimationMs } from "@/settings/tapAnimation";

import { cancelHeldTouch, holdTouch, moveHeldTouch, releaseHeldTouch } from "./heldTouch";
import { measureRect } from "./measureRect";
import { runPressedAt } from "./pressedRect";

const AnimatedPressable = withUniwind(createAnimatedComponent(Pressable));

/** Hands each `Press` its own key (`PressedElement.key`). */
let lastKey = 0;

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
  /**
   * Its tap opens a card (a menu floats next to it, `pressedRect`), as a
   * long-press does: it stays highlighted while the card is open.
   */
  opensMenu?: boolean;
  /** Looks pressed without a touch of its own (e.g. the menu entry a sliding finger is over). */
  highlighted?: boolean;
};

/** Where a touch event's finger is in the window, if it carries one. */
const pointOf = ({ nativeEvent }: GestureResponderEvent) =>
  Number.isFinite(nativeEvent.pageX) && Number.isFinite(nativeEvent.pageY)
    ? { x: nativeEvent.pageX, y: nativeEvent.pageY }
    : undefined;

/**
 * Every tappable thing in Wave. The press animation takes the duration set in
 * Settings (tap animation, in ms); 0 or the system's reduce-motion setting
 * makes it an instant dim instead. A long-press fires after the delay set in
 * Settings (long-press delay) unless the caller passes its own `delayLongPress`.
 */
export function Press({
  haptic,
  depth = 0.04,
  style: staticStyle,
  onPressIn,
  onPressOut,
  onPress,
  onLongPress,
  delayLongPress,
  opensMenu = false,
  highlighted = false,
  onTouchMove,
  onTouchEnd,
  onTouchCancel,
  children,
  accessibilityState,
  ...rest
}: Props) {
  const ms = useTapAnimationMs();
  const longPressDelay = useLongPressDelayMs();
  const reduceMotion = useReducedMotion();
  const pressed = useSharedValue(0);
  const lit = useSharedValue(highlighted ? 1 : 0);
  const view = useRef<ComponentRef<typeof View>>(null);
  // This press's finger long-pressed and is still down: it reports where it goes (`heldTouch`).
  const holding = useRef(false);
  const [key] = useState(() => ++lastKey);
  // Opened the card on screen: screen readers call it selected until the card closes.
  const origin = useIsOverlayOrigin(key);

  // A row that unmounts mid-hold can't report the finger lifting.
  useEffect(
    () => () => {
      if (holding.current) cancelHeldTouch();
    },
    [],
  );

  // Runs a handler that may open a menu, measuring where this sits first so the
  // menu can float next to it. Resolves with whether it opened one.
  const runAnchored = (handler: () => void): Promise<boolean> =>
    measureRect(view.current).then((rect) => runPressedAt(rect, handler, key));

  // The finger stays down as a long-press menu opens and can slide onto an entry
  // (slide to choose). A long-press that opens no menu (a tab's) lets it go again.
  const longPress = (event: GestureResponderEvent): void => {
    if (onLongPress == null) return;
    const point = pointOf(event);
    if (point !== undefined) {
      holding.current = true;
      holdTouch(point);
    }
    void runAnchored(() => onLongPress(event)).then((opened) => {
      if (!opened && holding.current) {
        holding.current = false;
        cancelHeldTouch();
      }
    });
  };

  const pressStyle = useAnimatedStyle(() => {
    const amount = Math.max(pressed.get(), lit.get());
    return {
      opacity: 1 - amount * 0.35,
      transform: [{ scale: reduceMotion ? 1 : 1 - amount * depth }],
    };
  });

  const animateTo = (value: number) => {
    pressed.set(ms === 0 ? value : withTiming(value, { duration: ms, easing: EASE }));
  };

  // Highlighted sinks and dims just like a press, with the same timing.
  useEffect(() => {
    const value = highlighted ? 1 : 0;
    lit.set(ms === 0 ? value : withTiming(value, { duration: ms, easing: EASE }));
  }, [highlighted, lit, ms]);

  return (
    <AnimatedPressable
      {...rest}
      accessibilityState={origin ? { ...accessibilityState, selected: true } : accessibilityState}
      ref={view}
      onPress={
        opensMenu && onPress != null ? (event) => void runAnchored(() => onPress(event)) : onPress
      }
      onLongPress={onLongPress == null ? undefined : longPress}
      delayLongPress={delayLongPress ?? longPressDelay}
      onTouchMove={(event) => {
        const point = pointOf(event);
        if (holding.current && point !== undefined) moveHeldTouch(point);
        onTouchMove?.(event);
      }}
      onTouchEnd={(event) => {
        if (holding.current) {
          holding.current = false;
          const point = pointOf(event);
          if (point === undefined) cancelHeldTouch();
          else releaseHeldTouch(point);
        }
        onTouchEnd?.(event);
      }}
      onTouchCancel={(event) => {
        if (holding.current) {
          holding.current = false;
          cancelHeldTouch();
        }
        onTouchCancel?.(event);
      }}
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
