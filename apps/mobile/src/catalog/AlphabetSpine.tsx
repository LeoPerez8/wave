import { spineLayout, spineStep, type IndexEntry } from "@wave/core";
import * as Haptics from "expo-haptics";
import { memo, useCallback, useMemo, useState } from "react";
import { AccessibilityInfo, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { useChromeInset } from "@/chrome/chrome";
import { ENTRY } from "@/motion/entry";
import { TAP_ANIMATION_MS } from "@/motion/timing";

import { spineLetterChange } from "./spineLetterChange";

import { CATALOG_TRACKING, CELL, grid } from "./grid";

/** Spine type's line height: a drawn letter needs this much of the spine. */
const LABEL_HEIGHT = 14;
/** Spine letters grow with the system font size up to this, then thin out instead. */
const MAX_FONT_SCALE = 1.3;
/** The letter plate beside the finger. */
const PLATE = CELL * 10;
/** The plate sits this far left of the spine's touch target, clear of the thumb. */
const PLATE_GAP = CELL * 2;
/** How small the plate starts as it grows in. */
const PLATE_FROM = 0.92;
/**
 * The plate's fade. It keeps running with reduce motion on (the plate then
 * only fades, without growing), as dialogs do.
 */
const FADE = { easing: ENTRY.ease, reduceMotion: ReduceMotion.Never } as const;

type Props = {
  /** The list's letters (Core `spineEntries`), each with the row it starts on. */
  entries: readonly IndexEntry[];
  /** Called once per letter change; jump the list to that row. */
  onJump: (entry: IndexEntry) => void;
  /** The row at the top of the list on screen, where screen-reader steps start from. */
  topRow: () => number;
};

/** What the spine shows: the letter last chosen, and whether a finger still holds it. */
type Chosen = { readonly letter: string | null; readonly held: boolean };

/**
 * Wave's signature move: a thin, tracked A–Z spine on the right edge, every
 * letter in a fixed place. Dragging it sets the letter in a plate beside the
 * finger, jumps the list there with a haptic tick per letter, and leaves the
 * list in view underneath.
 */
export function AlphabetSpine({ entries, onJump, topRow }: Props) {
  const reduceMotion = useReducedMotion();
  const chromeInset = useChromeInset();
  const { fontScale } = useWindowDimensions();
  const [space, setSpace] = useState(0);
  const [chosen, setChosen] = useState<Chosen>({ letter: null, held: false });
  const heldLetter = useSharedValue<string | null>(null);

  const layout = useMemo(
    () =>
      spineLayout(entries, {
        space: space - CELL * 2,
        slotHeight: grid.spineSlot,
        labelHeight: LABEL_HEIGHT * Math.min(fontScale, MAX_FONT_SCALE),
      }),
    [entries, space, fontScale],
  );
  // The plate follows the finger without crossing to JavaScript.
  const fingerY = useSharedValue(0);
  const shown = useSharedValue(0);
  const move = useCallback(
    (entry: IndexEntry) => {
      setChosen({ letter: entry.letter, held: true });
      void Haptics.selectionAsync();
      onJump(entry);
    },
    [onJump],
  );
  const release = useCallback(() => {
    setChosen((current) => ({ letter: current.letter, held: false }));
  }, []);
  const moveOnUI = (y: number) => {
    "worklet";
    fingerY.set(y);
    const entry = spineLetterChange(layout, y, heldLetter.get());
    if (entry === undefined) return;
    heldLetter.set(entry.letter);
    scheduleOnRN(move, entry);
  };

  const pan = usePanGesture({
    minDistance: 0,
    onBegin: (event) => {
      "worklet";
      const y = event.y - CELL;
      heldLetter.set(null);
      shown.set(withTiming(1, { duration: TAP_ANIMATION_MS, ...FADE }));
      moveOnUI(y);
    },
    onUpdate: (event) => {
      "worklet";
      const y = event.y - CELL;
      moveOnUI(y);
    },
    onFinalize: () => {
      "worklet";
      // Out in half the time it came in, so the rows it lands on are clear at once.
      shown.set(withTiming(0, { duration: TAP_ANIMATION_MS / 2, ...FADE }));
      heldLetter.set(null);
      scheduleOnRN(release);
    },
  });

  const railHeight = layout.height + CELL * 2;
  const plateStyle = useAnimatedStyle(() => {
    const top = Math.min(
      Math.max(0, railHeight - PLATE),
      Math.max(0, fingerY.get() + CELL - PLATE / 2),
    );
    const amount = shown.get();
    return {
      opacity: amount,
      transform: [
        { translateY: top },
        { scale: reduceMotion ? 1 : PLATE_FROM + (1 - PLATE_FROM) * amount },
      ],
    };
  });

  const step = (direction: 1 | -1) => {
    const entry = spineStep(entries, topRow(), direction, chosen.letter);
    if (entry === undefined) return;
    setChosen({ letter: entry.letter, held: false });
    onJump(entry);
    AccessibilityInfo.announceForAccessibility(entry.letter);
  };

  const active = chosen.held ? chosen.letter : null;

  return (
    <View
      pointerEvents="box-none"
      className="absolute justify-center"
      style={{ top: 0, bottom: chromeInset, right: grid.spineInset, left: 0 }}
      onLayout={(event) => setSpace(event.nativeEvent.layout.height)}
    >
      <View pointerEvents="box-none" style={{ height: railHeight }}>
        <Animated.View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          className="absolute items-center justify-center bg-fill"
          style={[
            { top: 0, right: grid.spineHit + PLATE_GAP, width: PLATE, height: PLATE },
            plateStyle,
          ]}
        >
          <Text
            allowFontScaling={false}
            className="font-sans text-index font-light text-foreground"
          >
            {chosen.letter}
          </Text>
        </Animated.View>
        <GestureDetector gesture={pan}>
          <View
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel="Alphabet index"
            accessibilityHint="Swipe up or down to jump to a letter"
            accessibilityValue={{ text: chosen.letter ?? entries[0]?.letter ?? "" }}
            accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
            onAccessibilityAction={(event) =>
              step(event.nativeEvent.actionName === "increment" ? 1 : -1)
            }
            // The touch target is wider than the drawn spine (48dp minimum).
            style={[styles.rail, { width: grid.spineHit, paddingLeft: grid.spineHit - grid.spine }]}
          >
            {layout.slots.map((slot) => (
              <Mark
                key={slot.letter}
                letter={slot.letter}
                label={slot.label}
                active={slot.letter === active}
                height={layout.slotHeight}
              />
            ))}
          </View>
        </GestureDetector>
      </View>
    </View>
  );
}

/** One place on the spine: its letter, or a dot when it isn't drawn. */
const Mark = memo(function Mark({
  letter,
  label,
  active,
  height,
}: {
  letter: string;
  label: boolean;
  active: boolean;
  height: number;
}) {
  return (
    <View className="items-center justify-center" style={{ height }}>
      {label ? (
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          className={`text-center font-sans text-[10px] font-semibold leading-[14px] ${
            active ? "text-accent" : "text-secondary"
          }`}
          style={{ letterSpacing: CATALOG_TRACKING / 2 }}
        >
          {letter}
        </Text>
      ) : (
        <View className={active ? "bg-accent" : "bg-secondary"} style={styles.dot} />
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  rail: { paddingVertical: CELL, alignSelf: "flex-end" },
  dot: { width: CELL / 4, height: CELL / 4 },
});
