import { IconRefresh } from "@tabler/icons-react-native";
import { mixPull } from "@wave/core";
import * as Haptics from "expo-haptics";
import { useState, type ReactNode } from "react";
import { ActivityIndicator, ScrollView, View, type AccessibilityActionEvent } from "react-native";
import { GestureDetector, useNativeGesture, usePanGesture } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { useListScrollable } from "@/motion/heldTouch";
import { useThemeColor } from "@/theme/useThemeColor";

import { COVER_ROW_TILE } from "./CoverRow";
import { CELL, grid } from "./grid";

/** Travel before a drag counts as a pull, in dp. */
const DRAG_SLOP = CELL * 1.5;

/** The refresh arrow's size, in dp. */
const ICON = CELL * 3;

const SPRING = { damping: 20, stiffness: 240 };

/**
 * A `CoverRow` (a row of covers that scrolls sideways, edge to edge) that
 * refreshes when pulled the "wrong" way: dragged right past its start, the
 * row gives, showing a refresh arrow at the left edge. Past Core's threshold
 * (`mixPull`) the arrow turns into a spinner with a light haptic tick, and
 * letting go calls [onRefresh]; letting go before springs back with nothing
 * done. Under reduce motion the arrow stays still and the spinner is a still
 * arrow. With [enabled] off (a refresh already running) it's a plain row.
 * Screen readers get the refresh as the row's action, named [refreshLabel].
 */
export function PullRefreshRow({
  children,
  onRefresh,
  enabled,
  refreshLabel,
}: {
  children: ReactNode;
  onRefresh: () => void;
  enabled: boolean;
  refreshLabel: string;
}) {
  const scrollable = useListScrollable();
  const reduceMotion = useReducedMotion();
  const accent = useThemeColor("accent");
  const secondary = useThemeColor("secondary");
  // How far the row is scrolled, in dp, and the finger's travel when it last sat at its start.
  const scrollX = useSharedValue(0);
  const base = useSharedValue(0);
  // How far the row has given to the pull, in dp, and how near it is to refreshing (0–1).
  const offset = useSharedValue(0);
  const progress = useSharedValue(0);
  const armedNow = useSharedValue(false);
  const [armed, setArmed] = useState(false);

  const arm = (on: boolean) => {
    setArmed(on);
    if (on) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const release = (refresh: boolean) => {
    setArmed(false);
    if (refresh) onRefresh();
  };

  // The row's own scrolling, which the pull goes along with.
  const scroll = useNativeGesture({ disallowInterruption: true });

  const pull = usePanGesture({
    enabled,
    // Rightwards only; a vertical move belongs to the screen.
    activeOffsetX: [-1_000_000, DRAG_SLOP],
    failOffsetY: [-DRAG_SLOP, DRAG_SLOP],
    simultaneousWith: scroll,
    onActivate: () => {
      "worklet";
      base.set(0);
    },
    onUpdate: (event) => {
      "worklet";
      // A drag begun along the row scrolls it back first: only travel at its start pulls.
      if (scrollX.get() > 0.5) base.set(event.translationX);
      const now = mixPull(event.translationX - base.get());
      offset.set(now.offset);
      progress.set(now.progress);
      if (now.armed !== armedNow.get()) {
        armedNow.set(now.armed);
        scheduleOnRN(arm, now.armed);
      }
    },
    onDeactivate: (event) => {
      "worklet";
      const refresh = !event.canceled && mixPull(event.translationX - base.get()).armed;
      armedNow.set(false);
      offset.set(withSpring(0, SPRING));
      progress.set(withSpring(0, SPRING));
      scheduleOnRN(release, refresh);
    },
  });

  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: offset.get() }] }));
  // Centred in the gap the row leaves at the left edge, over the covers' middle.
  const arrowStyle = useAnimatedStyle(() => ({
    opacity: progress.get(),
    transform: [
      { translateX: Math.max(0, (grid.margin + offset.get() - ICON) / 2) },
      { rotate: reduceMotion ? "0deg" : `${progress.get() * 180}deg` },
    ],
  }));

  const onAccessibilityAction = (event: AccessibilityActionEvent) => {
    if (event.nativeEvent.actionName === "refresh" && enabled) onRefresh();
  };

  return (
    <View
      style={{ marginHorizontal: -grid.margin }}
      accessibilityActions={enabled ? [{ name: "refresh", label: refreshLabel }] : []}
      onAccessibilityAction={onAccessibilityAction}
    >
      <Animated.View
        pointerEvents="none"
        importantForAccessibility="no-hide-descendants"
        style={[
          { position: "absolute", left: 0, top: (COVER_ROW_TILE - ICON) / 2, width: ICON },
          arrowStyle,
        ]}
      >
        {armed && !reduceMotion ? (
          <ActivityIndicator size="small" color={accent} />
        ) : (
          <IconRefresh size={ICON} color={armed ? accent : secondary} strokeWidth={1.5} />
        )}
      </Animated.View>
      <GestureDetector gesture={pull}>
        <Animated.View style={rowStyle}>
          <GestureDetector gesture={scroll}>
            <ScrollView
              scrollEnabled={scrollable}
              horizontal
              showsHorizontalScrollIndicator={false}
              overScrollMode="never"
              scrollEventThrottle={16}
              onScroll={(event) => scrollX.set(event.nativeEvent.contentOffset.x)}
              contentContainerStyle={{ paddingHorizontal: grid.margin, gap: grid.gutter }}
            >
              {children}
            </ScrollView>
          </GestureDetector>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
