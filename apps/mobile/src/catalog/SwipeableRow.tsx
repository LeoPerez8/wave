import { resolveRowSwipe, rowSwipeArmed, type RowSwipeSide } from "@wave/core";
import * as Haptics from "expo-haptics";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import {
  Text,
  View,
  type AccessibilityActionEvent,
  type AccessibilityActionInfo,
} from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { useListScrollable } from "@/motion/heldTouch";
import { ACTION_ICONS, type MenuAction } from "@/playback/actionIcons";
import { useThemeColor } from "@/theme/useThemeColor";

import { CELL } from "./grid";

/** What one swipe direction of a song row runs: an entry of the row's long-press menu. */
export interface SwipeSide {
  readonly action: MenuAction;
  /** The short label the row uncovers ("Add to Queue", "Remove"). */
  readonly label: string;
  /** The menu entry's full label, which screen readers offer as the row's action. */
  readonly accessibilityLabel: string;
  /** Removes or deletes the song: uncovered in the destructive colour. */
  readonly destructive: boolean;
  /** The row leaves the list as it runs (Remove from Playlist): it slides out first. */
  readonly leaves: boolean;
  readonly run: () => void;
}

/** A row's swipe directions: null where the row doesn't move. */
export interface RowSwipe {
  /** Swiping right (the row uncovers its left edge). */
  readonly right: SwipeSide | null;
  readonly left: SwipeSide | null;
}

export const NO_SWIPE: RowSwipe = { right: null, left: null };

const DRAG_SLOP = 12;

/** The light tick a row gives as it arms. */
const tick = () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
const SIDES: readonly RowSwipeSide[] = ["right", "left"];
const actionName = (side: RowSwipeSide): string => `swipe-${side}`;

/**
 * The swipes as screen-reader actions on the row, after [actions] (the
 * row's own, such as Move up in a playlist), and the handler that runs them
 * or passes the others to [onAction].
 */
export const swipeAccessibility = (
  swipe: RowSwipe,
  actions: readonly AccessibilityActionInfo[] | undefined,
  onAction: ((event: AccessibilityActionEvent) => void) | undefined,
): {
  readonly accessibilityActions: AccessibilityActionInfo[];
  readonly onAccessibilityAction: (event: AccessibilityActionEvent) => void;
} => ({
  accessibilityActions: [
    ...(actions ?? []),
    ...SIDES.flatMap((side) => {
      const action = swipe[side];
      return action === null ? [] : [{ name: actionName(side), label: action.accessibilityLabel }];
    }),
  ],
  onAccessibilityAction: (event) => {
    const side = SIDES.find((name) => actionName(name) === event.nativeEvent.actionName);
    const action = side === undefined ? null : swipe[side];
    if (action !== null) action.run();
    else onAction?.(event);
  },
});

/**
 * What a swipe uncovers on [side]'s edge: the action's icon and short label,
 * teal, or red for one that removes the song; full strength once armed.
 */
function Uncovered({ action, edge }: { action: SwipeSide; edge: "start" | "end" }) {
  const accent = useThemeColor("accent");
  const destructive = useThemeColor("destructive");
  const Icon = ACTION_ICONS[action.action];
  const colour = action.destructive ? destructive : accent;
  return (
    <View
      className={`absolute inset-0 flex-row items-center bg-fill ${edge === "start" ? "justify-start" : "justify-end"}`}
      style={{ gap: CELL, paddingHorizontal: CELL * 2 }}
    >
      <Icon size={20} color={colour} strokeWidth={1.5} />
      <Text
        numberOfLines={1}
        className={`font-sans text-body font-medium ${action.destructive ? "text-destructive" : "text-accent"}`}
      >
        {action.label}
      </Text>
    </View>
  );
}

/**
 * A song row that swipes sideways to run an action of its menu ([swipe]):
 * past a third of its width it arms with a light tick, letting go runs the
 * action, letting go sooner springs back (with reduce motion, it goes back
 * at once). A direction without an action doesn't move. Vertical drags stay
 * the list's; taps and long-presses stay the row's. No swipe while
 * [enabled] is false (selection mode) or while a long-pressed finger slides
 * to choose in a menu.
 */
export function SwipeableRow({
  swipe,
  enabled = true,
  children,
}: {
  swipe: RowSwipe;
  enabled?: boolean;
  children: ReactNode;
}) {
  const scrollable = useListScrollable();
  const reduceMotion = useReducedMotion();
  const canRight = swipe.right !== null;
  const canLeft = swipe.left !== null;
  const active = enabled && scrollable && (canRight || canLeft);

  const offsetX = useSharedValue(0);
  const width = useSharedValue(1);
  const armed = useSharedValue<RowSwipeSide | null>(null);
  const widthRef = useRef(1);
  // The latest actions, for a swipe that ends after the row re-rendered.
  const swipeRef = useRef(swipe);
  useLayoutEffect(() => {
    swipeRef.current = swipe;
  });

  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offsetX.get() }],
  }));
  // Each edge shows while the row moves off it, faint until armed.
  const strength = (moved: number) => {
    "worklet";
    return moved <= 0 ? 0 : rowSwipeArmed({ translationX: moved, width: width.get() }) ? 1 : 0.5;
  };
  const rightStyle = useAnimatedStyle(() => ({ opacity: strength(offsetX.get()) }));
  const leftStyle = useAnimatedStyle(() => ({ opacity: strength(-offsetX.get()) }));

  const settle = () => {
    offsetX.set(reduceMotion ? 0 : withSpring(0, { damping: 20, stiffness: 240 }));
  };

  const finish = (translationX: number, velocityX: number, canceled: boolean) => {
    const side = canceled
      ? null
      : resolveRowSwipe(
          { translationX, velocityX, width: widthRef.current },
          { right: swipeRef.current.right !== null, left: swipeRef.current.left !== null },
        );
    const action = side === null ? null : swipeRef.current[side];
    if (side === null || action === null) {
      settle();
      return;
    }
    if (!action.leaves || reduceMotion) {
      if (!action.leaves) settle();
      action.run();
      return;
    }
    const away = side === "left" ? -widthRef.current : widthRef.current;
    offsetX.set(
      withTiming(away, { duration: 160 }, (finished) => {
        if (finished) scheduleOnRN(action.run);
      }),
    );
  };

  const pan = usePanGesture({
    enabled: active,
    // Only towards the sides with an action; a vertical move belongs to the list.
    activeOffsetX:
      canRight && canLeft ? [-DRAG_SLOP, DRAG_SLOP] : canRight ? DRAG_SLOP : -DRAG_SLOP,
    failOffsetY: [-DRAG_SLOP, DRAG_SLOP],
    onUpdate: (event) => {
      "worklet";
      const x = event.translationX;
      const shown = (x > 0 && canRight) || (x < 0 && canLeft) ? x : 0;
      offsetX.set(shown);
      const now = rowSwipeArmed({ translationX: shown, width: width.get() });
      if (now !== armed.get()) {
        armed.set(now);
        if (now !== null) scheduleOnRN(tick);
      }
    },
    onDeactivate: (event) => {
      "worklet";
      armed.set(null);
      scheduleOnRN(finish, event.translationX, event.velocityX, event.canceled);
    },
  });

  return (
    <View
      onLayout={(event) => {
        const measured = Math.max(1, event.nativeEvent.layout.width);
        widthRef.current = measured;
        width.set(measured);
      }}
    >
      {swipe.right !== null && (
        <Animated.View pointerEvents="none" className="absolute inset-0" style={rightStyle}>
          <Uncovered action={swipe.right} edge="start" />
        </Animated.View>
      )}
      {swipe.left !== null && (
        <Animated.View pointerEvents="none" className="absolute inset-0" style={leftStyle}>
          <Uncovered action={swipe.left} edge="end" />
        </Animated.View>
      )}
      <GestureDetector gesture={pan}>
        <Animated.View className="bg-background" style={contentStyle}>
          {children}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
