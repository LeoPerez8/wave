import { useLocalisation } from "@/localisation/localisation";
import {
  currentEntry,
  HOLD_SKIP_REPEAT_MS,
  holdSkipSeconds,
  holdSkipStep,
  type HoldSkipDirection,
} from "@wave/core";
import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { CELL } from "@/catalog/grid";
import { seekTo } from "@/playback/actions";
import { positionState } from "@/playback/Player";
import { currentPositionMs, queueState } from "@/playback/Queue";

/** How long the label stays once the jumps stop, before it fades. */
const LABEL_LINGER_MS = 600;
const LABEL_FADE_IN_MS = 160;
const LABEL_FADE_OUT_MS = 240;
/** How far the label rises as it shows, in dp. */
const LABEL_RISE = CELL;

/** The current song's queue key, to tell when a hold's song has changed. */
const playingKey = (): string | null => currentEntry(queueState.get())?.key ?? null;

/** What a held Next or Previous shows: the total moved so far, while it shows. */
export interface HoldSkipLabelState {
  readonly movedMs: number;
  /** Counts the jumps, so each one shows the label, even the hold's last. */
  readonly jumps: number;
  /** The jumps go on; once they stop, the label lingers, then fades. */
  readonly holding: boolean;
}

/**
 * Holding Next ([direction] "forward") or Previous ("back") in Now Playing
 * (story 38d): the song jumps 5 seconds as the long press is recognised, then
 * every `HOLD_SKIP_REPEAT_MS` until the finger lifts, the jump reaches the
 * start or the end (Core's `holdSkipStep`), or the song changes. Each jump
 * has a light haptic. Hands the button its long press and press-out, and the
 * label what to show.
 */
export function useHoldSkip(direction: HoldSkipDirection) {
  const [label, setLabel] = useState<HoldSkipLabelState>({
    movedMs: 0,
    jumps: 0,
    holding: false,
  });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hold = useRef<{ key: string | null; movedMs: number } | null>(null);

  const stop = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    const ended = hold.current;
    hold.current = null;
    // A hold that moved nothing showed no label, so it has none to fade.
    if (ended !== null && ended.movedMs !== 0) setLabel((shown) => ({ ...shown, holding: false }));
  };

  // One jump; [repeat] schedules the next while the hold goes on.
  const jump = (repeat: boolean) => {
    const running = hold.current;
    if (running === null) return;
    if (playingKey() !== running.key) return stop();
    const step = holdSkipStep(
      { positionMs: currentPositionMs(), durationMs: positionState.get().durationMs },
      direction,
      running.movedMs,
    );
    if (step.movedMs !== running.movedMs) {
      running.movedMs = step.movedMs;
      seekTo(step.positionMs, "scrubber");
      void Haptics.selectionAsync();
      setLabel((shown) => ({ movedMs: step.movedMs, jumps: shown.jumps + 1, holding: true }));
    }
    if (step.last || !repeat) return stop();
    timer.current = setTimeout(() => jump(true), HOLD_SKIP_REPEAT_MS);
  };

  const begin = (repeat: boolean) => {
    stop();
    hold.current = { key: playingKey(), movedMs: 0 };
    jump(repeat);
  };

  useEffect(() => stop, []);

  return {
    label,
    press: { onLongPress: () => begin(true), onPressOut: stop },
    /** A single jump, for the screen reader's action. */
    once: () => begin(false),
  };
}

/** Holding play/pause: the song starts over at 0:00, playing or paused as it was. */
export const restartFromHold = (): void => {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  seekTo(0, "previousRestart");
};

/**
 * The label over a held Next or Previous: the seconds moved so far (+10 s,
 * −5 s). It rises into view with the first jump, stays while the jumps run,
 * and fades a moment after they stop; under reduce motion it only fades.
 * Screen readers skip it: the button's actions say what happened.
 */
export function HoldSkipLabel({
  direction,
  state,
}: {
  direction: HoldSkipDirection;
  state: HoldSkipLabelState;
}) {
  const { strings } = useLocalisation();
  const reduceMotion = useReducedMotion();
  const shown = useSharedValue(0);
  // How far up the label has risen: it rises as it shows and fades where it is.
  const risen = useSharedValue(0);
  const { jumps, holding } = state;
  useEffect(() => {
    if (jumps === 0) return;
    const easing = Easing.out(Easing.cubic);
    const fadeIn = withTiming(1, { duration: LABEL_FADE_IN_MS, easing });
    if (shown.get() === 0) risen.set(0);
    risen.set(withTiming(1, { duration: LABEL_FADE_IN_MS, easing }));
    const fadeOut = withDelay(
      LABEL_LINGER_MS,
      withTiming(0, { duration: LABEL_FADE_OUT_MS, easing: Easing.in(Easing.cubic) }),
    );
    shown.set(holding ? fadeIn : withSequence(fadeIn, fadeOut));
  }, [jumps, holding, shown, risen]);
  const style = useAnimatedStyle(() => ({
    opacity: shown.get(),
    transform: [{ translateY: reduceMotion ? 0 : (1 - risen.get()) * LABEL_RISE }],
  }));
  const seconds = holdSkipSeconds(state.movedMs);
  return (
    <View
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      className="absolute items-center"
      style={{ bottom: "100%", left: -CELL * 4, right: -CELL * 4 }}
    >
      <Animated.View style={style}>
        <Text
          className="font-sans text-footnote font-medium text-foreground"
          style={{ fontVariant: ["tabular-nums"] }}
        >
          {direction === "forward"
            ? strings.playbackText.holdSkipForward(seconds)
            : strings.playbackText.holdSkipBack(seconds)}
        </Text>
      </Animated.View>
    </View>
  );
}
