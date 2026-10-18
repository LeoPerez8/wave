import {
  cardContentHeight,
  cardKeyboard,
  cardShowsHeading,
  placeOverlayCard,
  veilPath,
  visibleHighlight,
  withOpacity,
  type OverlayRect,
} from "@wave/core";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentRef,
  type ReactNode,
} from "react";
import {
  AccessibilityInfo,
  BackHandler,
  Keyboard,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";

import { CELL, grid } from "@/catalog/grid";
import { OnOverlayCard } from "@/catalog/Hairline";
import { BACKDROP, useFloatingChromeHeight } from "@/chrome/chrome";
import { Glass } from "@/glass/Glass";
import { useThemeColor } from "@/theme/useThemeColor";

import {
  closeOverlay,
  dismissOverlay,
  removeOverlay,
  useOverlayEntries,
  type OverlayEntry,
} from "./overlay";
import { CardHeadingContext } from "./CardHeading";
import { OverlayFlowContext } from "./flow";
import { useKeyboardHeight } from "./keyboard";
import { ToastHost } from "./ToastHost";
import { useEnterAndLeave } from "./useEnterAndLeave";

/** Rounded corners of a dialog card. */
export const OVERLAY_RADIUS = CELL * 3;

/** Inner padding of a dialog card; content lays out inside it. */
export const OVERLAY_PADDING = { horizontal: CELL * 3, vertical: CELL * 2 } as const;

/** Cards never grow wider than this (landscape, tablets). */
const MAX_WIDTH = CELL * 56;

/**
 * The shortest an anchored card (a menu) shrinks to stay beside its row: a
 * few entries (or a heading and a couple) at the default text size; Core
 * scales it with larger text. With less room it covers the row instead.
 */
const MIN_ANCHORED_HEIGHT = CELL * 20;

/** How much smaller a card starts before it grows into place. */
const ENTER_SCALE = 0.94;

/** The veil behind a card: the theme's scrim colour at a quarter strength. */
const SCRIM_OPACITY = 0.25;

/**
 * What a card was opened from stays clear of the veil, washed with the accent
 * at this strength so it stands out on any theme. The wash fills the clear hole
 * exactly, so no corner of a row's artwork pokes out.
 */
const ORIGIN_TINT_OPACITY = 0.16;

/**
 * Rounded corners of the veil's hole and the wash that fills it, square like the
 * row, unless the origin brings its own (the Library | Online toggle's pill).
 */
const ORIGIN_RADIUS = CELL;

/**
 * Hosts Wave's glass dialogs and its toast. Wrap the app's navigator with it:
 * the navigator becomes the backdrop the glass shows through, and the cards
 * and toast float above it in the same window. Android Back dismisses the top card.
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
      <ToastHost />
    </>
  );
}

/** One dimmed backdrop and its glass card, fading and growing in and out. */
function OverlayCard({ entry, frontmost }: { entry: OverlayEntry; frontmost: boolean }) {
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  // A card without a text field closes the keyboard (one tap then runs an entry).
  const keyboard = cardKeyboard({ align: entry.request.align, keyboard: keyboardHeight });
  const scrim = useThemeColor("scrim");
  const accent = useThemeColor("accent");
  const reduceMotion = useReducedMotion();
  const card = useRef<ComponentRef<typeof View>>(null);
  const layer = useRef<ComponentRef<typeof View>>(null);
  const [cardHeight, setCardHeight] = useState<number | null>(null);
  const measured = cardHeight !== null;
  const anchor = entry.request.anchor;
  const chromeBottom = useFloatingChromeHeight();
  const origin = {
    insets,
    chromeBottom,
    rect: entry.origin?.rect,
    onChrome: entry.origin?.onChrome ?? false,
  };
  // The veil's own size: the window, unless edge-to-edge drawing makes it taller.
  const [veil, setVeil] = useState<{ width: number; height: number } | null>(null);
  // What shows of the origin: never drawn over the floating chrome.
  const highlight = visibleHighlight({ window: veil ?? window, ...origin });
  const highlightRadius = entry.origin?.radius ?? ORIGIN_RADIUS;
  // Settled as the card opens, from the veil's frame like the highlight: its heading never
  // comes or goes under a sliding finger. Null until the veil is measured.
  const [settledHeading, setSettledHeading] = useState<boolean | null>(null);
  const showsHeading = settledHeading ?? highlight === undefined;
  // The window and origin as the card opens, which settle the heading.
  const [opening] = useState(() => ({ window, origin }));

  const frame = placeOverlayCard({
    window,
    insets,
    margin: grid.margin,
    maxWidth: MAX_WIDTH,
    cardHeight: cardHeight ?? 0,
    // Anchored or centred, the card may draw over the floating chrome: only the system bars bound it.
    ...(anchor === undefined
      ? {}
      : { anchor: { rect: anchor, gap: CELL, minHeight: MIN_ANCHORED_HEIGHT } }),
    align: entry.request.align,
    keyboard: keyboard.keyboard,
    // Large system text draws a menu's heading and entries taller: it needs more room by its row.
    textScale: window.fontScale,
  });

  // Only as the card opens: a card someone types into above it may bring the keyboard back.
  const [closeKeyboard] = useState(keyboard.closeKeyboard);
  useEffect(() => {
    if (closeKeyboard) Keyboard.dismiss();
  }, [closeKeyboard]);

  // Fabric lays the card out before this runs and answers measurements synchronously, so
  // the hidden, unbounded first layout is read here and the card re-renders in place
  // before anything is drawn: no wait for `onLayout` to come back through JS.
  // The veil is read first: the heading it settles changes the card's height, read next.
  useLayoutEffect(() => {
    const size = layer.current;
    const measuredVeil =
      size != null && size.offsetWidth > 0 && size.offsetHeight > 0
        ? { width: size.offsetWidth, height: size.offsetHeight }
        : null;
    if (measuredVeil !== null) setVeil(measuredVeil);
    setSettledHeading(
      cardShowsHeading({ window: measuredVeil ?? opening.window, ...opening.origin }),
    );
  }, [opening]);
  useLayoutEffect(() => {
    if (settledHeading === null) return;
    const height = card.current?.offsetHeight ?? 0;
    if (height > 0) setCardHeight(height);
  }, [settledHeading]);

  // Fade in once the card knows its size (so it appears where it settles), out when closing.
  const progress = useEnterAndLeave({
    id: entry.id,
    ready: measured,
    leaving: entry.closing,
    remove: removeOverlay,
  });

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
      ref={layer}
      style={StyleSheet.absoluteFill}
      pointerEvents={entry.closing ? "none" : "box-none"}
      importantForAccessibility={frontmost ? "auto" : "no-hide-descendants"}
    >
      <Animated.View
        style={[StyleSheet.absoluteFill, veilStyle]}
        onLayout={({ nativeEvent: { layout } }) =>
          setVeil({ width: layout.width, height: layout.height })
        }
      >
        {/* The whole veil closes the card, the clear highlight included. */}
        <Pressable
          style={{ flex: 1 }}
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={() => dismissOverlay(entry)}
        >
          <Svg
            pointerEvents="none"
            width={(veil ?? window).width}
            height={(veil ?? window).height}
            style={StyleSheet.absoluteFill}
          >
            <Path
              d={veilPath(veil ?? window, highlight, highlightRadius)}
              fill={withOpacity(scrim, SCRIM_OPACITY)}
              fillRule="evenodd"
            />
          </Svg>
          {/* Only the frontmost card's veil tints it, so stacked cards don't deepen it. */}
          {highlight !== undefined && frontmost && (
            <View
              pointerEvents="none"
              style={{
                ...frameOf(highlight),
                borderRadius: highlightRadius,
                backgroundColor: withOpacity(accent, ORIGIN_TINT_OPACITY),
              }}
            />
          )}
        </Pressable>
      </Animated.View>
      <Animated.View
        ref={card}
        accessibilityLabel={entry.request.label}
        onLayout={(event) => {
          // Content that changes height later (a list that grows) re-places the card.
          const laidOut = event.nativeEvent.layout.height;
          setCardHeight((known) =>
            known === null
              ? laidOut
              : cardContentHeight({ known, laidOut, maxHeight: frame.maxHeight }),
          );
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
        <OnOverlayCard value>
          <OverlayFlowContext value={frame.flow}>
            <CardHeadingContext value={showsHeading}>
              {entry.request.render(() => closeOverlay(entry.id))}
            </CardHeadingContext>
          </OverlayFlowContext>
        </OnOverlayCard>
      </Animated.View>
    </View>
  );
}

/** Absolute position and size of a window rect. */
const frameOf = (rect: OverlayRect) =>
  ({
    position: "absolute",
    left: rect.left,
    top: rect.top,
    width: rect.right - rect.left,
    height: rect.bottom - rect.top,
  }) as const;
