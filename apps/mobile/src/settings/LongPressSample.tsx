import { currentLocalisation } from "@/localisation/localisation";
import { useLocalisation } from "@/localisation/localisation";
import {
  LONG_PRESS_SAMPLE_MENU,
  longPressFill,
  longPressHoldStep,
  withOpacity,
  type HeldFinger,
  type SampleTouch,
  type SampleTouchEvent,
} from "@wave/core";
import { useEffect, useEffectEvent, useRef } from "react";
import { Text, View, type GestureResponderEvent } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";

import { Artwork } from "@/catalog/Artwork";
import { CELL } from "@/catalog/grid";
import { pressedRect } from "@/motion/pressedRect";
import { TAP_ANIMATION_MS } from "@/motion/timing";
import { CardHeading } from "@/overlay/CardHeading";
import { MenuChoices } from "@/overlay/MenuChoices";
import { openOverlay } from "@/overlay/overlay";
import { useThemeColor } from "@/theme/useThemeColor";

import { useLongPressDelayMs } from "./longPressDelay";
import { SampleSongRow } from "./SampleSongRow";

/** The fill's wash of the accent: visible under the row's text in either appearance. */
const FILL_OPACITY = 0.16;
const OPEN_ACTION = "longpress";

/**
 * The sample menu: a song's long-press card for the sample song, with Play
 * Next, Add to Queue and Add to Playlist. Slide to choose and taps highlight
 * as in a real menu, and every item only closes the card.
 */
function SampleMenu({ close }: { close: () => void }) {
  const { strings } = useLocalisation();
  return (
    <>
      <CardHeading>
        <Artwork uri={undefined} size={CELL * 5} />
        <View className="flex-1">
          <Text numberOfLines={1} className="font-sans text-body font-medium text-foreground">
            {strings.settings.sampleSong}
          </Text>
          <Text numberOfLines={1} className="font-sans text-body text-secondary">
            Wave
          </Text>
        </View>
      </CardHeading>
      <MenuChoices
        cards={LONG_PRESS_SAMPLE_MENU.cards.map((action) => ({ action, onPress: close }))}
        entries={LONG_PRESS_SAMPLE_MENU.list.map((entry) => ({
          ...entry,
          label: strings.itemActions.labels[entry.action],
          onPress: close,
        }))}
        accessibilityHint={strings.settings.demoItemItOnlyClosesTheMenu}
      />
    </>
  );
}

/** Opens the sample menu next to the row a long-press is running for (centred from TalkBack). */
const openSampleMenu = (): void => {
  openOverlay({
    label: currentLocalisation().strings.settings.sampleMenu,
    anchor: pressedRect(),
    render: (close) => <SampleMenu close={close} />,
  });
};

const fingersOf = (touches: GestureResponderEvent["nativeEvent"]["touches"] | undefined) =>
  (touches ?? []).map((touch): SampleTouch => ({
    id: touch.identifier,
    x: touch.pageX,
    y: touch.pageY,
  }));

const touchEventOf = (
  kind: SampleTouchEvent["kind"],
  { nativeEvent }: GestureResponderEvent,
): SampleTouchEvent => ({
  kind,
  touches: fingersOf(nativeEvent.touches),
  changed: fingersOf(nativeEvent.changedTouches),
});

/**
 * Long-press delay's sample: the sample song row to hold. A fill sweeps
 * across it over the current delay (only this sample shows one), then the
 * long-press haptic fires (the song row's own) and the sample menu opens,
 * anchored to the row. Lifting early, drifting off as a real row's long-press
 * would, or scrolling the page stops the fill and opens nothing; other
 * fingers touching the screen meanwhile change nothing (`longPressHoldStep`).
 * Each change of [demo] sweeps the fill once over the delay, with no menu.
 * Under reduce motion nothing fills.
 */
export function LongPressSample({ demo }: { demo: number }) {
  const { strings } = useLocalisation();
  const delayMs = useLongPressDelayMs();
  const reduceMotion = useReducedMotion();
  const accent = useThemeColor("accent");
  const progress = useSharedValue(0);
  const shown = useSharedValue(0);
  // The finger holding the row and where it went down; null when no hold is running.
  const hold = useRef<HeldFinger | null>(null);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${progress.get() * 100}%`,
    opacity: shown.get(),
  }));

  const sweep = (durationMs: number, fadeAtEnd: boolean): void => {
    cancelAnimation(progress);
    cancelAnimation(shown);
    progress.set(0);
    shown.set(1);
    progress.set(withTiming(1, { duration: durationMs, easing: Easing.linear }));
    if (fadeAtEnd) shown.set(withDelay(durationMs, withTiming(0, { duration: TAP_ANIMATION_MS })));
  };
  const fade = (): void => {
    cancelAnimation(progress);
    shown.set(withTiming(0, { duration: TAP_ANIMATION_MS }));
  };
  const follow = (kind: SampleTouchEvent["kind"], event: GestureResponderEvent): void => {
    const step = longPressHoldStep(hold.current, touchEventOf(kind, event));
    hold.current = step.hold;
    if (step.fill === "stop") fade();
    if (step.fill === "start") {
      const fill = longPressFill({ delayMs, reduceMotion });
      if (fill !== null) sweep(fill.durationMs, false);
    }
  };

  const sweepOnce = useEffectEvent(() => {
    const fill = longPressFill({ delayMs, reduceMotion });
    if (fill !== null) sweep(fill.durationMs, true);
  });
  // After the commit, so the sweep runs over the delay the slider just set.
  useEffect(() => {
    if (demo > 0) sweepOnce();
  }, [demo]);

  return (
    <SampleSongRow
      accessibilityHint={strings.settings.showsTheLongpressDelayWhenHeldOpens}
      accessibilityActions={[{ name: OPEN_ACTION, label: strings.settings.openTheSampleMenu }]}
      onAccessibilityAction={({ nativeEvent }) => {
        if (nativeEvent.actionName === OPEN_ACTION) openSampleMenu();
      }}
      onTouchStart={(event) => follow("start", event)}
      onTouchMove={(event) => follow("move", event)}
      onTouchEnd={(event) => follow("end", event)}
      onTouchCancel={(event) => follow("cancel", event)}
      onLongPress={() => {
        hold.current = null;
        fade();
        openSampleMenu();
      }}
      behind={
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: "absolute",
              top: 0,
              bottom: 0,
              left: 0,
              backgroundColor: withOpacity(accent, FILL_OPACITY),
            },
            fillStyle,
          ]}
        />
      }
    />
  );
}
