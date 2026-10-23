import { IconRefresh } from "@tabler/icons-react-native";
import { MIX_PULL_SLOP, mixPull, mixPullCanStart, RETURN_SPRINGS } from "@wave/core";
import * as Haptics from "expo-haptics";
import { useState, type ReactNode } from "react";
import { ActivityIndicator, View, type AccessibilityActionEvent } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, {
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { useBounceScale, useBounceSpring } from "@/motion/bounce";
import { useListScrollable } from "@/motion/heldTouch";
import { useThemeColor } from "@/theme/useThemeColor";

import { COVER_ROW_TILE } from "./CoverRow";
import { CELL, grid } from "./grid";

/** The refresh arrow's size, in dp. */
const ICON = CELL * 3;

/**
 * A `CoverRow` (a row of covers that scrolls sideways, edge to edge) that
 * refreshes when pulled the "wrong" way: dragged right past its start, the
 * row gives, showing a refresh arrow at the left edge. Past Core's threshold
 * (`mixPull`) the arrow turns into a spinner with a light haptic tick, and
 * letting go calls [onRefresh]; letting go before springs back with nothing
 * done. How far the row gives and how far it springs past its rest follow
 * the Bounce amount (at 0% the row holds still and only the arrow shows; the
 * threshold is the finger's travel at every amount). Under reduce motion the
 * row holds still, the arrow doesn't turn and the spinner is a still arrow.
 * With [enabled] off (a refresh already running) it's a plain row.
 * Screen readers get the refresh as the row's action, named [refreshLabel].
 *
 * The row scrolls as a plain `CoverRow` does, with no gesture of its own on
 * its scroll view: Home's scroll view is React Native's, which Gesture
 * Handler can't arbitrate with, and a native gesture wrapping the row kept a
 * vertical drag begun on its bare part (beside a lone mix, past the last
 * cover) from scrolling Home (#525). The pull is a pan around the row, armed
 * only while the row sits at its start (`mixPullCanStart`), and it settles
 * within `MIX_PULL_SLOP`, before Android's touch slop: rightwards first it
 * takes the touch, up or down first it fails and Home scrolls.
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
  // How far the row is scrolled, in dp, followed on the UI thread; a pull can start only at its start.
  const scrollX = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((event) => {
    scrollX.set(event.contentOffset.x);
  });
  const pullable = useDerivedValue(() => enabled && mixPullCanStart(scrollX.get()), [enabled]);
  // The Bounce amount, for the worklets: how far the row gives and how it springs back.
  const bounce = useBounceScale();
  const returnSpring = useBounceSpring(RETURN_SPRINGS.pullRow);
  const give = useDerivedValue(() => bounce, [bounce]);
  const spring = useDerivedValue(() => returnSpring, [returnSpring]);
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

  const pull = usePanGesture({
    enabled: pullable,
    // Rightwards only; a vertical move belongs to the screen, a leftward one to the row.
    activeOffsetX: [-1_000_000, MIX_PULL_SLOP],
    failOffsetY: [-MIX_PULL_SLOP, MIX_PULL_SLOP],
    onUpdate: (event) => {
      "worklet";
      const now = mixPull(event.translationX, give.get());
      offset.set(now.offset);
      progress.set(now.progress);
      if (now.armed !== armedNow.get()) {
        armedNow.set(now.armed);
        scheduleOnRN(arm, now.armed);
      }
    },
    onDeactivate: (event) => {
      "worklet";
      const refresh = !event.canceled && mixPull(event.translationX).armed;
      armedNow.set(false);
      offset.set(withSpring(0, spring.get()));
      progress.set(withSpring(0, spring.get()));
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
          <Animated.ScrollView
            scrollEnabled={scrollable}
            horizontal
            showsHorizontalScrollIndicator={false}
            overScrollMode="never"
            scrollEventThrottle={16}
            onScroll={onScroll}
            contentContainerStyle={{ paddingHorizontal: grid.margin, gap: grid.gutter }}
          >
            {children}
          </Animated.ScrollView>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
