import { placeOverlayCard } from "@wave/core";
import { useEffect, useRef, useState, type ComponentRef, type ReactNode } from "react";
import {
  AccessibilityInfo,
  BackHandler,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";

import { CELL, grid } from "@/catalog/grid";
import { OnOverlayCard } from "@/catalog/Hairline";
import { BACKDROP, useFloatingChromeHeight } from "@/chrome/chrome";
import { Glass } from "@/glass/Glass";
import { useTapAnimationMs } from "@/settings/tapAnimation";
import { useThemeColor } from "@/theme/useThemeColor";

import {
  closeOverlay,
  dismissOverlay,
  removeOverlay,
  useOverlayEntries,
  type OverlayEntry,
} from "./overlay";
import { useKeyboardHeight } from "./keyboard";

/** Rounded corners of a dialog card. */
export const OVERLAY_RADIUS = CELL * 3;

/** Inner padding of a dialog card; content lays out inside it. */
export const OVERLAY_PADDING = { horizontal: CELL * 3, vertical: CELL * 2 } as const;

/** Cards never grow wider than this (landscape, tablets). */
const MAX_WIDTH = CELL * 56;

/**
 * The shortest an anchored card (a menu) shrinks to stay beside its row: its
 * heading and a couple of entries. With less room it covers the row instead.
 */
const MIN_ANCHORED_HEIGHT = CELL * 20;

/** How much smaller a card starts before it grows into place. */
const ENTER_SCALE = 0.94;

const EASE = Easing.out(Easing.exp);

/** The veil behind a card: the theme's scrim colour at a quarter strength (hex alpha). */
const SCRIM_ALPHA = "40";

/**
 * Hosts Wave's glass dialogs. Wrap the app's navigator with it: the navigator
 * becomes the backdrop the cards' glass shows through, and the cards float
 * above it in the same window. Android Back dismisses the top card.
 */
export function OverlayHost({ children }: { children: ReactNode }) {
  const entries = useOverlayEntries();
  const open = entries.some((entry) => !entry.closing);

  useEffect(() => {
    if (!open) return undefined;
    // Runs before any screen's handler: screens register theirs through
    // `addScreenBackHandler`, which steps aside while a card is open.
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      const top = entries.findLast((entry) => !entry.closing);
      if (top !== undefined) dismissOverlay(top);
      return true;
    });
    return () => subscription.remove();
  }, [open, entries]);

  const frontmost = entries.findLast((entry) => !entry.closing);

  return (
    <>
      <View
        nativeID={BACKDROP.root}
        collapsable={false}
        style={{ flex: 1 }}
        importantForAccessibility={open ? "no-hide-descendants" : "auto"}
      >
        {children}
      </View>
      {entries.map((entry) => (
        <OverlayCard key={entry.id} entry={entry} frontmost={entry === frontmost} />
      ))}
    </>
  );
}

/** One dimmed backdrop and its glass card, fading and growing in and out. */
function OverlayCard({ entry, frontmost }: { entry: OverlayEntry; frontmost: boolean }) {
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();
  const ms = useTapAnimationMs();
  const scrim = useThemeColor("scrim");
  const reduceMotion = useReducedMotion();
  const card = useRef<ComponentRef<typeof View>>(null);
  const [cardHeight, setCardHeight] = useState<number | null>(null);
  const progress = useSharedValue(0);
  const measured = cardHeight !== null;
  const anchor = entry.request.anchor;
  const chromeBottom = useFloatingChromeHeight();

  const frame = placeOverlayCard({
    window,
    insets,
    margin: grid.margin,
    maxWidth: MAX_WIDTH,
    cardHeight: cardHeight ?? 0,
    ...(anchor === undefined
      ? {}
      : { anchor: { rect: anchor, gap: CELL, minHeight: MIN_ANCHORED_HEIGHT }, chromeBottom }),
    align: entry.request.align,
    keyboard,
  });

  // Fade in once the card knows its size (so it appears where it settles), out when closing.
  useEffect(() => {
    if (!measured) return;
    const target = entry.closing ? 0 : 1;
    const remove = () => removeOverlay(entry.id);
    if (ms === 0) {
      progress.set(target);
      if (entry.closing) remove();
      return;
    }
    progress.set(
      withTiming(target, { duration: ms, easing: EASE }, (finished) => {
        if (finished && target === 0) scheduleOnRN(remove);
      }),
    );
  }, [measured, entry.closing, entry.id, ms, progress]);

  // A card closed before it measured never showed; drop it straight away.
  useEffect(() => {
    if (entry.closing && !measured) removeOverlay(entry.id);
  }, [entry.closing, measured, entry.id]);

  // Screen readers move into the card as it opens.
  useEffect(() => {
    if (measured && frontmost && !entry.closing && card.current !== null) {
      AccessibilityInfo.sendAccessibilityEvent(card.current, "focus");
    }
  }, [measured, frontmost, entry.closing]);

  const veilStyle = useAnimatedStyle(() => ({ opacity: progress.get() }));
  const cardStyle = useAnimatedStyle(() => ({
    opacity: progress.get(),
    transform: [{ scale: reduceMotion ? 1 : ENTER_SCALE + (1 - ENTER_SCALE) * progress.get() }],
  }));

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents={entry.closing ? "none" : "box-none"}
      importantForAccessibility={frontmost ? "auto" : "no-hide-descendants"}
    >
      <Animated.View style={[StyleSheet.absoluteFill, veilStyle]}>
        <Pressable
          style={{ flex: 1, backgroundColor: `${scrim}${SCRIM_ALPHA}` }}
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={() => dismissOverlay(entry)}
        />
      </Animated.View>
      <Animated.View
        ref={card}
        accessibilityLabel={entry.request.label}
        onLayout={(event) => {
          // Placement needs the content's own height: a layout cut short by maxHeight isn't it.
          const { height } = event.nativeEvent.layout;
          if (!measured || height < frame.maxHeight - 1) setCardHeight(height);
        }}
        style={[
          {
            position: "absolute",
            left: frame.left,
            top: frame.top,
            width: frame.width,
            // The first, hidden layout is unbounded so the card shows its full height.
            ...(measured ? { maxHeight: frame.maxHeight } : {}),
            borderRadius: OVERLAY_RADIUS,
            overflow: "hidden",
            paddingHorizontal: OVERLAY_PADDING.horizontal,
            paddingVertical: OVERLAY_PADDING.vertical,
            // An anchored card grows out of its row's edge.
            ...(frame.side === undefined
              ? {}
              : { transformOrigin: frame.side === "below" ? "top" : "bottom" }),
          },
          cardStyle,
        ]}
      >
        <Glass backdropId={BACKDROP.root} cornerRadius={OVERLAY_RADIUS} />
        <OnOverlayCard value>{entry.request.render(() => closeOverlay(entry.id))}</OnOverlayCard>
      </Animated.View>
    </View>
  );
}
