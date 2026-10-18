import { toastDuration, toastSwipeDismisses } from "@wave/core";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AccessibilityInfo, Text, View } from "react-native";
import {
  GestureDetector,
  useExclusiveGestures,
  usePanGesture,
  useTapGesture,
} from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";

import { CELL, grid } from "@/catalog/grid";
import { BACKDROP, chrome } from "@/chrome/chrome";
import { Glass } from "@/glass/Glass";
import { useTapAnimationMs } from "@/settings/tapAnimation";

import { currentToast, dismissToast, removeToast, runToastAction, type Toast } from "./toast";
import { useEnterAndLeave } from "./useEnterAndLeave";

/** The pill's corners: fully round on one line, an overlay card's corners on more. */
const MAX_RADIUS = CELL * 3;

/** How far the toast drops as it comes in, in dp. */
const DROP = CELL * 2;

/** Travel before a drag takes over from a tap, in dp. */
const DRAG_SLOP = CELL * 1.5;

/** A line longer than this many lines is cut. */
const MAX_LINES = 3;

/** The pill's padding at either end, in dp. */
const PADDING_X = CELL * 2.5;

/** The gap between the line and the action, in dp. */
const ACTION_GAP = CELL * 2;

/** A pill with an action is at least a touch target tall, in dp. */
const ACTION_MIN_HEIGHT = CELL * 6;

/**
 * Draws the toast (`showToast`) at the top of the screen, over everything:
 * Now Playing, open cards and menus. Render it at the app root, after the
 * cards and outside the backdrop its glass shows through: `OverlayHost` does.
 */
export function ToastHost() {
  const toast = useSyncExternalStore(currentToast.subscribe, currentToast.get);
  // A newer toast mounts afresh, so it comes in instead of changing in place.
  return toast === null ? null : <ToastPill key={toast.id} toast={toast} />;
}

/**
 * The line on a glass pill, centred a gap under the status bar and clear of
 * any camera cutout (the safe area's insets, which follow the rotation). It
 * leaves after Core's `toastDuration` (longer when Android's accessibility
 * timeout asks), on a tap, or on a swipe up. An action sits at its end: a tap
 * there, from half the gap before it to the pill's edge, runs it.
 */
function ToastPill({ toast }: { toast: Toast }) {
  const insets = useSafeAreaInsets();
  const ms = useTapAnimationMs();
  const reduceMotion = useReducedMotion();
  const [height, setHeight] = useState<number | null>(null);
  const size = useRef({ height: 1 });
  // The same height, for the animated style on the UI thread.
  const pillHeight = useSharedValue(1);
  const dragging = useRef(false);
  const expired = useRef(false);
  // How far it's dragged up, in dp: zero or negative.
  const offsetY = useSharedValue(0);
  // Where the action's tap area starts across the pill, in dp.
  const actionStart = useRef(Number.POSITIVE_INFINITY);
  const { id, text, action, leaving } = toast;

  // Screen readers say the line as it shows.
  useEffect(() => AccessibilityInfo.announceForAccessibility(text), [text]);

  // Leaves on its own; a toast held under a finger waits for the finger to lift.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const duration = toastDuration(text, { withAction: action !== null });
    void AccessibilityInfo.getRecommendedTimeoutMillis(duration).then((timeout) => {
      if (cancelled) return;
      timer = setTimeout(() => {
        expired.current = true;
        if (!dragging.current) dismissToast(id);
      }, timeout);
    });
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id, text, action]);

  // Comes in once it knows its size, goes when leaving, then is taken off.
  const progress = useEnterAndLeave({ id, ready: height !== null, leaving, remove: removeToast });

  const startDrag = () => {
    dragging.current = true;
  };

  const settle = () => {
    dragging.current = false;
    offsetY.set(withSpring(0, { damping: 20, stiffness: 240 }));
    if (expired.current) dismissToast(id);
  };

  const endDrag = (translationY: number, velocityY: number, canceled: boolean) => {
    if (canceled || !toastSwipeDismisses({ translationY, velocityY, ...size.current })) {
      settle();
      return;
    }
    dragging.current = false;
    // It carries on up, off the top, as it fades.
    offsetY.set(withTiming(-size.current.height * 2, { duration: ms === 0 ? 0 : 160 }));
    dismissToast(id);
  };

  const pan = usePanGesture({
    // Up only: down points into the screen, and sideways is no swipe.
    activeOffsetY: [-DRAG_SLOP, 1_000_000],
    failOffsetX: [-DRAG_SLOP, DRAG_SLOP],
    onActivate: () => {
      "worklet";
      scheduleOnRN(startDrag);
    },
    onUpdate: (event) => {
      "worklet";
      offsetY.set(Math.min(0, event.translationY));
    },
    onDeactivate: (event) => {
      "worklet";
      scheduleOnRN(endDrag, event.translationY, event.velocityY, event.canceled);
    },
  });
  const tap = useTapGesture({
    runOnJS: true,
    onActivate: (event) => (event.x >= actionStart.current ? runToastAction(id) : dismissToast(id)),
  });
  const gesture = useExclusiveGestures(pan, tap);

  const style = useAnimatedStyle(() => {
    const away = -offsetY.get() / (pillHeight.get() * 2);
    return {
      opacity: progress.get() * (1 - Math.min(1, away) * 0.8),
      transform: [{ translateY: offsetY.get() - (reduceMotion ? 0 : (1 - progress.get()) * DROP) }],
    };
  });

  const radius = Math.min((height ?? 0) / 2, MAX_RADIUS);

  return (
    <View
      pointerEvents="box-none"
      className="absolute items-center"
      style={{
        left: insets.left + grid.margin,
        right: insets.right + grid.margin,
        top: insets.top + chrome.gap,
      }}
    >
      <GestureDetector gesture={gesture}>
        <Animated.View
          accessible
          accessibilityLabel={text}
          accessibilityHint="Dismisses"
          accessibilityActions={[
            { name: "activate" },
            ...(action === null ? [] : [{ name: "action", label: action.label }]),
          ]}
          onAccessibilityAction={(event) =>
            event.nativeEvent.actionName === "action" ? runToastAction(id) : dismissToast(id)
          }
          pointerEvents={leaving ? "none" : "auto"}
          onLayout={({ nativeEvent: { layout } }) => {
            size.current = { height: Math.max(1, layout.height) };
            pillHeight.set(size.current.height);
            setHeight(layout.height);
          }}
          style={[
            {
              borderRadius: radius,
              overflow: "hidden",
              flexDirection: "row",
              alignItems: "center",
              paddingHorizontal: PADDING_X,
              paddingVertical: CELL * 1.5,
              minHeight: action === null ? undefined : ACTION_MIN_HEIGHT,
            },
            style,
          ]}
        >
          <Glass backdropId={BACKDROP.root} cornerRadius={radius} />
          <Text
            numberOfLines={MAX_LINES}
            className="shrink text-center font-sans text-subheadline font-medium text-foreground"
          >
            {text}
          </Text>
          {action === null ? null : (
            <Text
              numberOfLines={1}
              onLayout={({ nativeEvent: { layout } }) => {
                actionStart.current = layout.x - ACTION_GAP / 2;
              }}
              className="font-sans text-body font-medium text-accent"
              style={{ marginLeft: ACTION_GAP }}
            >
              {action.label}
            </Text>
          )}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
