import {
  DJ_FILTERS,
  DJ_MOOD_FILTERS,
  djAdjustGroups,
  djAdjustSheetHeight,
  djAdjustSheetSwipeCloses,
  djFilterOn,
  djToggleFilter,
  djToggleMood,
  withOpacity,
  type DjAdjustGroup,
  type DjSettings,
} from "@wave/core";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";

import { CELL } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { BACKDROP } from "@/chrome/chrome";
import { TextButton } from "@/components/TextButton";
import { Glass } from "@/glass/Glass";
import { useLocalisation } from "@/localisation/localisation";
import { Press } from "@/motion/Press";
import { TAP_ANIMATION_MS } from "@/motion/timing";
import { useThemeColor } from "@/theme/useThemeColor";

/** The sheet's corners, in dp. */
const RADIUS = CELL * 4;

/** How far the sheet rises as it comes in, in dp. */
const RISE = CELL * 3;

/** The scrim over DJ's grid while the sheet is up: the theme's scrim colour at this strength. */
const SCRIM_OPACITY = 0.55;

/** Travel before a drag on the handle takes over, in dp. */
const DRAG_SLOP = CELL;

/** The grab handle's bar, in dp. */
const HANDLE = { width: CELL * 4.5, height: CELL / 2 } as const;

/** An option's text and its 2dp underline, a touch target tall. */
const OPTION = { paddingTop: CELL * 1.75, paddingBottom: CELL * 1.5, underline: 2 } as const;

/** Ease-out exponential: fast to respond, quiet to settle. */
const EASE = Easing.out(Easing.exp);

/** Whether Adjust's sheet is up, and how far it has come in (0 to 1). */
export type DjAdjustSheetState = {
  readonly open: boolean;
  /** Drawn: open, or still leaving. */
  readonly shown: boolean;
  readonly progress: SharedValue<number>;
};

/**
 * The sheet's coming and going for [open]: it rises and fades in over
 * 140 ms, fades out as fast, and stays drawn until it's gone. Under Remove
 * animations it appears and leaves at once (Reanimated's timing follows the
 * system setting). A layout effect, so it starts with the frame it's drawn in.
 */
export const useDjAdjustSheet = (open: boolean): DjAdjustSheetState => {
  const progress = useSharedValue(0);
  const [shown, setShown] = useState(open);
  if (open && !shown) setShown(true);
  useLayoutEffect(() => {
    if (!shown) return;
    const gone = () => setShown(false);
    progress.set(
      withTiming(open ? 1 : 0, { duration: TAP_ANIMATION_MS, easing: EASE }, (finished) => {
        if (finished && !open) scheduleOnRN(gone);
      }),
    );
  }, [open, shown, progress]);
  return { open, shown, progress };
};

/**
 * The scrim that dims DJ's grid while the sheet is up; a tap on it closes the
 * sheet. Draw it last inside the view the sheet's glass shows through, so the
 * glass shows the grid dimmed. Screen readers skip it: Back closes the sheet.
 */
export function DjAdjustScrim({
  sheet,
  onClose,
}: {
  sheet: DjAdjustSheetState;
  onClose: () => void;
}) {
  const scrim = useThemeColor("scrim");
  const style = useAnimatedStyle(() => ({ opacity: sheet.progress.get() }));
  if (!sheet.shown) return null;
  return (
    <Animated.View
      pointerEvents={sheet.open ? "auto" : "none"}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        StyleSheet.absoluteFill,
        { backgroundColor: withOpacity(scrim, SCRIM_OPACITY) },
        style,
      ]}
    >
      <Pressable accessible={false} style={StyleSheet.absoluteFill} onPress={onClose} />
    </Animated.View>
  );
}

/**
 * One of Adjust's option groups: its name in Footnote 500 graphite, its three
 * options side by side on a hairline (the chosen one in the primary colour,
 * underlined 2dp), then the chosen one's note. Screen readers hear a radio
 * group with its name and each option's selected state.
 */
function OptionGroup({
  group,
  disabled,
  onChange,
}: {
  group: DjAdjustGroup;
  disabled: boolean;
  onChange: (settings: DjSettings) => void;
}) {
  return (
    <View style={{ paddingTop: CELL * 2.5 }}>
      <Text className="font-sans text-footnote font-medium text-secondary">{group.name}</Text>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={group.name}
        className="flex-row"
        style={{ marginTop: CELL, opacity: disabled ? 0.4 : 1 }}
      >
        <Hairline className="absolute bottom-0 left-0 right-0" />
        {group.options.map((option) => (
          <Press
            key={option.label}
            accessibilityRole="radio"
            // The group's name comes first: TalkBack doesn't read a radio group's own label.
            accessibilityLabel={`${group.name}, ${option.label}`}
            accessibilityState={{ checked: option.selected, disabled }}
            disabled={disabled}
            onPress={() => {
              if (!option.selected) onChange(option.settings);
            }}
            className={`flex-1 items-center ${option.selected ? "border-accent" : "border-transparent"}`}
            style={{
              paddingTop: OPTION.paddingTop,
              paddingBottom: OPTION.paddingBottom,
              borderBottomWidth: OPTION.underline,
            }}
          >
            <Text
              numberOfLines={1}
              className={`font-sans text-subheadline ${option.selected ? "font-medium text-accent" : "text-secondary"}`}
            >
              {option.label}
            </Text>
          </Press>
        ))}
      </View>
      <Text className="font-sans text-footnote text-secondary" style={{ paddingTop: CELL }}>
        {group.note}
      </Text>
    </View>
  );
}

/** A group of Adjust's pills under its name, as the option groups are named. */
function PillGroup({ name, children }: { name: string; children: ReactNode }) {
  return (
    <View style={{ paddingTop: CELL * 2.5 }}>
      <Text
        accessibilityRole="header"
        className="font-sans text-footnote font-medium text-secondary"
      >
        {name}
      </Text>
      <View className="flex-row flex-wrap" style={{ gap: CELL, paddingTop: CELL * 1.5 }}>
        {children}
      </View>
    </View>
  );
}

/**
 * DJ's Adjust sheet (docs/spec.md, DJ, Adjust): how the queue Play starts
 * should behave, over the grid it changes. A glass sheet a cell clear of the
 * screen's edges, with 32dp corners and a grab handle: the "Adjust" title,
 * Artist variety and Music discovery as three options each (Core's
 * `djAdjustGroups`) with their notes, the Filters pills (Trending and
 * Lesser-known songs one at a time, Core's `djToggleFilter`, and New
 * releases), the Mood pills, and at its bottom [children], the Play pill.
 * A choice applies at once; while [disabled] (the first batch is read) none
 * can change. Its content scrolls past about 85% of the screen
 * (`djAdjustSheetHeight`). A swipe down on the handle closes it
 * (`djAdjustSheetSwipeCloses`); a short one springs back. The choices are
 * DJ's own: they move no slider of Discover's and change no other queue or
 * mix.
 */
export function DjAdjustSheet({
  sheet,
  settings,
  disabled,
  onChange,
  onClose,
  children,
}: {
  sheet: DjAdjustSheetState;
  settings: DjSettings;
  disabled: boolean;
  onChange: (settings: DjSettings) => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const { strings } = useLocalisation();
  const insets = useSafeAreaInsets();
  const { height: window } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  // How far the handle has pulled the sheet down, in dp: zero or more.
  const offsetY = useSharedValue(0);
  const height = useRef(1);
  const { open } = sheet;
  useLayoutEffect(() => {
    if (open) offsetY.set(0);
  }, [open, offsetY]);

  const endDrag = (translationY: number, velocityY: number, canceled: boolean): void => {
    const settle = { duration: TAP_ANIMATION_MS, easing: EASE };
    if (
      canceled ||
      !djAdjustSheetSwipeCloses({ translationY, velocityY, height: height.current })
    ) {
      offsetY.set(withTiming(0, settle));
      return;
    }
    // It carries on down as it fades.
    offsetY.set(withTiming(height.current, settle));
    onClose();
  };
  const pan = usePanGesture({
    // Down only, and sideways is no swipe.
    activeOffsetY: [-1_000_000, DRAG_SLOP],
    failOffsetX: [-DRAG_SLOP, DRAG_SLOP],
    onUpdate: (event) => {
      "worklet";
      offsetY.set(Math.max(0, event.translationY));
    },
    onDeactivate: (event) => {
      "worklet";
      scheduleOnRN(endDrag, event.translationY, event.velocityY, event.canceled);
    },
  });

  const style = useAnimatedStyle(() => ({
    opacity: sheet.progress.get(),
    transform: [
      { translateY: offsetY.get() + (reduceMotion ? 0 : (1 - sheet.progress.get()) * RISE) },
    ],
  }));

  if (!sheet.shown) return null;
  const pill = (filter: (typeof DJ_FILTERS)[number]) => {
    const on = djFilterOn(settings, filter);
    return (
      <TextButton
        key={filter}
        variant="pill"
        tone="secondary"
        label={strings.dj.filterNames[filter]}
        selected={on}
        disabled={disabled}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: on }}
        onPress={() => onChange(djToggleFilter(settings, filter))}
        style={{ paddingHorizontal: CELL * 2 }}
      />
    );
  };
  return (
    <Animated.View
      accessibilityViewIsModal
      pointerEvents={open ? "auto" : "none"}
      onLayout={({ nativeEvent: { layout } }) => {
        height.current = Math.max(1, layout.height);
      }}
      style={[
        {
          position: "absolute",
          left: insets.left + CELL,
          right: insets.right + CELL,
          bottom: insets.bottom + CELL,
          maxHeight: djAdjustSheetHeight({ window, top: insets.top, bottom: insets.bottom }),
          borderRadius: RADIUS,
          overflow: "hidden",
        },
        style,
      ]}
    >
      <Glass backdropId={BACKDROP.dj} cornerRadius={RADIUS} />
      <GestureDetector gesture={pan}>
        <View
          className="items-center"
          style={{ paddingTop: CELL * 1.5, paddingBottom: CELL * 2 }}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <View className="bg-tertiary" style={{ ...HANDLE, borderRadius: HANDLE.height / 2 }} />
        </View>
      </GestureDetector>
      <ScrollView
        style={{ flexShrink: 1 }}
        contentContainerStyle={{ paddingHorizontal: CELL * 3 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text
          accessibilityRole="header"
          className="font-sans text-title2 font-normal text-foreground"
        >
          {strings.dj.adjust}
        </Text>
        {djAdjustGroups(settings, strings).map((group) => (
          <OptionGroup key={group.key} group={group} disabled={disabled} onChange={onChange} />
        ))}
        <PillGroup name={strings.dj.filters}>{DJ_FILTERS.map(pill)}</PillGroup>
        <PillGroup name={strings.dj.mood}>
          {DJ_MOOD_FILTERS.map((mood) => {
            const on = settings.mood === mood;
            return (
              <TextButton
                key={mood}
                variant="pill"
                tone="secondary"
                label={strings.dj.moodNames[mood]}
                selected={on}
                disabled={disabled}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                onPress={() => onChange(djToggleMood(settings, mood))}
                style={{ paddingHorizontal: CELL * 2 }}
              />
            );
          })}
        </PillGroup>
      </ScrollView>
      <View style={{ padding: CELL * 2, paddingTop: CELL * 3, gap: CELL }}>{children}</View>
    </Animated.View>
  );
}
