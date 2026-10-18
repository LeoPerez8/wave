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
import { BACKDROP, chrome, useFloatingChromeHeight } from "@/chrome/chrome";
import { Glass } from "@/glass/Glass";
import { useTapAnimationMs } from "@/settings/tapAnimation";

import { currentToast, dismissToast, removeToast, runToastAction, type Toast } from "./toast";
import { useEnterAndLeave } from "./useEnterAndLeave";

/** The pill's corners: fully round on one line, an overlay card's corners on more. */
const MAX_RADIUS = CELL * 3;

/** How far the toast rises as it comes in, in dp. */
const RISE = CELL * 2;

/** Travel before a drag takes over from a tap, in dp. */
const DRAG_SLOP = CELL * 1.5;

/** A line longer than this many lines is cut. */
const MAX_LINES = 3;

/** The pill's padding at either end, in dp. */
const PADDING_X = CELL * 2.5;

/** The gap between the line and the action, in dp. */
const ACTION_GAP = CELL * 2;

/**
 * Draws the toast (`showToast`) above the floating chrome. Render it at the
 * app root, outside the backdrop its glass shows through: `OverlayHost` does.
 */
export function ToastHost() {
  const toast = useSyncExternalStore(currentToast.subscribe, currentToast.get);
  // A newer toast mounts afresh, so it comes in instead of changing in place.
  return toast === null ? null : <ToastPill key={toast.id} toast={toast} />;
}

/**
 * The line on a glass pill, centred a gap above the mini player (or whatever
 * floating chrome the screen has). It leaves after Core's `toastDuration`
 * (longer when Android's accessibility timeout asks), on a tap, or on a swipe
 * sideways or down. An action sits at its end: a tap there, from half the gap
 * before it to the pill's edge, runs it.
 */
function ToastPill({ toast }: { toast: Toast }) {
  const insets = useSafeAreaInsets();
  const chromeHeight = useFloatingChromeHeight();
  const ms = useTapAnimationMs();
  const reduceMotion = useReducedMotion();
  const [height, setHeight] = useState<number | null>(null);
  const size = useRef({ width: 1, height: 1 });
  // The same size, for the animated style on the UI thread.
  const width = useSharedValue(1);
  const pillHeight = useSharedValue(1);
  const dragging = useRef(false);
  const expired = useRef(false);
  const offsetX = useSharedValue(0);
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
    const duration = toastDuration(text, { action: action?.label });
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
    offsetX.set(withSpring(0, { damping: 20, stiffness: 240 }));
    offsetY.set(withSpring(0, { damping: 20, stiffness: 240 }));
    if (expired.current) dismissToast(id);
  };

  const endDrag = (
    translationX: number,
    translationY: number,
    velocityX: number,
    velocityY: number,
    canceled: boolean,
  ) => {
    const swipe = { translationX, translationY, velocityX, velocityY, ...size.current };
    if (canceled || !toastSwipeDismisses(swipe)) {
      settle();
      return;
    }
    dragging.current = false;
    // It carries on the way it was swiped as it fades.
    const duration = ms === 0 ? 0 : 160;
    if (Math.abs(translationX) >= Math.abs(translationY))
      offsetX.set(withTiming(Math.sign(translationX) * size.current.width, { duration }));
    else offsetY.set(withTiming(size.current.height * 2, { duration }));
    dismissToast(id);
  };

  const pan = usePanGesture({
    activeOffsetX: [-DRAG_SLOP, DRAG_SLOP],
    // Down only: up points into the screen.
    activeOffsetY: [-1_000_000, DRAG_SLOP],
    onActivate: () => {
      "worklet";
      scheduleOnRN(startDrag);
    },
    onUpdate: (event) => {
      "worklet";
      offsetX.set(event.translationX);
      offsetY.set(Math.max(0, event.translationY));
    },
    onDeactivate: (event) => {
      "worklet";
      scheduleOnRN(
        endDrag,
        event.translationX,
        event.translationY,
        event.velocityX,
        event.velocityY,
        event.canceled,
      );
    },
  });
  const tap = useTapGesture({
    runOnJS: true,
    onActivate: (event) =>
      event.x >= actionStart.current ? runToastAction(id) : dismissToast(id),
  });
  const gesture = useExclusiveGestures(pan, tap);

  const style = useAnimatedStyle(() => {
    const away = Math.max(
      Math.abs(offsetX.get()) / width.get(),
      offsetY.get() / (pillHeight.get() * 2),
    );
    return {
      opacity: progress.get() * (1 - Math.min(1, away) * 0.8),
      transform: [
        { translateX: offsetX.get() },
        { translateY: offsetY.get() + (reduceMotion ? 0 : (1 - progress.get()) * RISE) },
      ],
    };
  });

  const radius = Math.min((height ?? 0) / 2, MAX_RADIUS);

  return (
    <View
      pointerEvents="box-none"
      className="absolute items-center"
      style={{
        left: grid.margin,
        right: grid.margin,
        bottom: insets.bottom + chromeHeight + chrome.gap,
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
            size.current = {
              width: Math.max(1, layout.width),
              height: Math.max(1, layout.height),
            };
            width.set(size.current.width);
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
              className="font-sans text-subheadline font-semibold text-accent"
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
