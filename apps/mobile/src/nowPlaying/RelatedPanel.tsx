import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";

import { CELL, grid } from "@/catalog/grid";
import { useListScrollable } from "@/motion/heldTouch";

import { Background, type GroundColors } from "./Background";
import type { ScreenPages } from "./ScreenPages";

/** Downward travel before the drag takes over from a tap, in dp. */
const DRAG_SLOP = CELL * 1.5;

/**
 * Related's panel: it rises from the bottom over the whole of Now Playing
 * (its header, the player or the Queue, the scrubber, the transport and the
 * buttons) on the sheet's own ground, and leaves the same way. Out of place
 * it takes no touches and screen readers skip it.
 */
export function RelatedPanel({
  pages,
  ground,
  children,
}: {
  pages: ScreenPages;
  ground: GroundColors;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { related } = pages;
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - related.get()) * height }],
  }));
  const here = pages.screen === "related";
  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, style]}
      pointerEvents={here ? "auto" : "none"}
      importantForAccessibility={here ? "auto" : "no-hide-descendants"}
      accessibilityElementsHidden={!here}
    >
      <Background colors={ground} />
      <View
        className="flex-1"
        style={{
          paddingTop: insets.top,
          paddingBottom: insets.bottom + CELL * 2,
          paddingHorizontal: grid.margin,
        }}
      >
        {children}
      </View>
    </Animated.View>
  );
}

/**
 * The part of Related that drags its panel down, back to the player: the
 * panel follows the finger and Core's sheet rule settles the release
 * (`relatedDragEnded`). Now Playing itself stays open. With reduce motion
 * (Remove animations) on, the panel holds still and leaves at once on release.
 */
export function RelatedDragArea({
  pages,
  children,
  style,
}: {
  pages: ScreenPages;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { height } = useWindowDimensions();
  const still = useReducedMotion();
  // A long-pressed finger slides onto its menu's entries; it doesn't drag the panel.
  const draggable = useListScrollable();
  const { related, relatedDragBegan, relatedDragEnded } = pages;
  const pan = usePanGesture({
    enabled: draggable,
    // Only a drag down claims the touch; up never does.
    activeOffsetY: [-1_000_000, DRAG_SLOP],
    failOffsetX: [-DRAG_SLOP * 2, DRAG_SLOP * 2],
    onActivate: () => {
      "worklet";
      scheduleOnRN(relatedDragBegan);
    },
    onUpdate: (event) => {
      "worklet";
      if (still || height <= 0) return;
      related.set(Math.min(1, Math.max(0, 1 - event.translationY / height)));
    },
    onDeactivate: (event) => {
      "worklet";
      // A touch taken away settles back where it started.
      const released = !event.canceled;
      scheduleOnRN(
        relatedDragEnded,
        released ? Math.max(0, event.translationY) : 0,
        released ? event.velocityY : 0,
      );
    },
  });
  return (
    <GestureDetector gesture={pan}>
      <View style={style}>{children}</View>
    </GestureDetector>
  );
}
