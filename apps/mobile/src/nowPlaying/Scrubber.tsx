import {
  UNDERLINE_WAVE,
  currentEntry,
  elapsedWavePath,
  extrapolatePosition,
  formatDuration,
  formatRemaining,
  scrubPosition,
} from "@wave/core";
import * as Haptics from "expo-haptics";
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { StyleSheet, TextInput, View, type TextInputProps } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, {
  createAnimatedComponent,
  useAnimatedProps,
  useDerivedValue,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";
import Svg, { Path, type PathProps } from "react-native-svg";
import { scheduleOnRN, scheduleOnUI } from "react-native-worklets";
import { withUniwind } from "uniwind";

import { CELL } from "@/catalog/grid";
import { perfCount, useRenderCount } from "@/perf/perf";
import { seekTo } from "@/playback/actions";
import { positionState } from "@/playback/Player";
import { queueState } from "@/playback/Queue";
import { useThemeColor } from "@/theme/useThemeColor";

import { playhead, usePlayheadDuration } from "./playhead";

/** How far a screen reader's increment / decrement moves the playhead. */
const STEP_MS = 10_000;

const BAR = 2;
const BAR_SCRUBBING = CELL / 2;
/** The playing-song underline's wave, scaled up (same wavelength : amplitude). */
const WAVELENGTH = CELL * 2;
const AMPLITUDE = (WAVELENGTH * UNDERLINE_WAVE.amplitude) / UNDERLINE_WAVE.wavelength;
/** Box tall enough for crest, trough and the boldest stroke around them. */
const HEIGHT = AMPLITUDE * 2 + BAR_SCRUBBING;
const CENTRE = HEIGHT / 2;

/** No finger on the bar, or no release waiting for JavaScript. */
const NONE = -1;

const AnimatedPath = createAnimatedComponent(Path);
const AnimatedTextInput = withUniwind(createAnimatedComponent(TextInput));

const TABULAR = { fontVariant: ["tabular-nums" as const] };

/** Lets go of a release once JavaScript has dealt with it, unless the finger let go again since. */
const letGo = (released: SharedValue<number>, at: number): void => {
  "worklet";
  if (released.get() === at) released.set(NONE);
};

/** The playing entry's key: a seek only applies to the song the finger was on. */
const playingKey = (): string | null => currentEntry(queueState.get())?.key ?? null;

/**
 * The playhead: the elapsed part is a still teal wave, the shape of the
 * playing song's underline, that meets a flat graphite line at the playhead;
 * then elapsed and remaining time. Touch anywhere on it and drag to scrub;
 * the bar gets bolder and the track seeks when the finger lifts.
 *
 * The finger is followed on the UI thread: the bar and the times move with it
 * while JavaScript is busy, and JavaScript hears only the release, which it
 * seeks to. The release stays on screen until a render shows the seek.
 */
export function Scrubber() {
  useRenderCount("Scrubber");
  const durationMs = usePlayheadDuration();
  const entryKey = useSyncExternalStore(queueState.subscribe, playingKey);
  const [width, setWidth] = useState(0);
  const duration = durationMs ?? 0;
  const enabled = duration > 0;

  // The shared playhead and the finger both stay on the UI thread.
  const bar = useSharedValue({ width, durationMs: duration });
  const entry = useSharedValue(entryKey);
  // Where the finger points while it's down.
  const scrub = useSharedValue(NONE);
  // The entry the finger went down on.
  const grabbed = useSharedValue<string | null>(null);
  // Where the finger let go, shown until JavaScript has seeked there or dropped the seek.
  const released = useSharedValue(NONE);
  useLayoutEffect(() => bar.set({ width, durationMs: duration }), [bar, width, duration]);
  useLayoutEffect(() => entry.set(entryKey), [entry, entryKey]);

  // A seek made: the first render after it shows it, then the bar lets go of the release.
  const seeked = useRef<number | null>(null);
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  useLayoutEffect(() => {
    const at = seeked.current;
    if (at === null) return;
    seeked.current = null;
    scheduleOnUI(letGo, released, at);
  });

  const commit = useCallback(
    (at: number, key: string | null) => {
      perfCount("scrub.release");
      // The song changed under the finger (a skip, the queue moving on): the
      // release was meant for the one before, so nothing seeks.
      if (key !== playingKey()) {
        scheduleOnUI(letGo, released, at);
        return;
      }
      seekTo(at, "scrubber");
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      seeked.current = at;
      rerender();
    },
    [released],
  );

  const pan = usePanGesture(
    useMemo(() => {
      const at = (x: number): number => {
        "worklet";
        const { width: barWidth, durationMs: barDuration } = bar.get();
        return scrubPosition({ x, width: barWidth, durationMs: barDuration });
      };
      return {
        enabled,
        minDistance: 0,
        onActivate: (event: { x: number }) => {
          "worklet";
          grabbed.set(entry.get());
          scrub.set(at(event.x));
        },
        onUpdate: (event: { x: number }) => {
          "worklet";
          scrub.set(at(event.x));
        },
        onDeactivate: (event: { x: number; canceled: boolean }) => {
          "worklet";
          scrub.set(NONE);
          if (event.canceled) return;
          const target = at(event.x);
          released.set(target);
          scheduleOnRN(commit, target, grabbed.get());
        },
      };
    }, [enabled, bar, entry, grabbed, scrub, released, commit]),
  );

  // The position on show: the finger's, a release's, or the playhead's.
  const shown = useDerivedValue(() => {
    const finger = scrub.get();
    const release = released.get();
    const ms = finger !== NONE ? finger : release !== NONE ? release : playhead.positionMs.get();
    return Math.min(ms, bar.get().durationMs);
  });
  // Where the wave meets the line, in dp from the bar's left end.
  const join = useDerivedValue(() => {
    const { width: barWidth, durationMs: barDuration } = bar.get();
    return barDuration > 0 ? (shown.get() / barDuration) * barWidth : 0;
  });
  const lineProps = useAnimatedProps<PathProps>(() => {
    const barWidth = bar.get().width;
    const x = join.get();
    return {
      d: x < barWidth ? `M${x} ${CENTRE}H${barWidth}` : "",
      strokeWidth: scrub.get() === NONE ? BAR : BAR_SCRUBBING,
    };
  });
  const waveProps = useAnimatedProps<PathProps>(() => {
    const length = join.get();
    return {
      d:
        length > 0 ? elapsedWavePath({ length, wavelength: WAVELENGTH, amplitude: AMPLITUDE }) : "",
      strokeWidth: scrub.get() === NONE ? BAR : BAR_SCRUBBING,
    };
  });

  // Native text props follow the same UI-thread position, including during a drag.
  const elapsedProps = useAnimatedProps(() => {
    const text = formatDuration(shown.get());
    return { text, defaultValue: text, accessibilityLabel: text } as TextInputProps;
  });
  const remainingProps = useAnimatedProps(() => {
    const length = bar.get().durationMs;
    const text = length > 0 ? formatRemaining(shown.get(), length) : "–:––";
    return { text, defaultValue: text, accessibilityLabel: text } as TextInputProps;
  });
  const accessibilityProps = useAnimatedProps(() => ({
    accessibilityValue: {
      text: `${formatDuration(shown.get())} of ${formatDuration(bar.get().durationMs)}`,
    },
  }));

  const [accent, tertiary] = useThemeColor(["accent", "tertiary"]);

  return (
    <View>
      <GestureDetector gesture={pan}>
        <Animated.View
          animatedProps={accessibilityProps}
          accessible
          accessibilityRole="adjustable"
          accessibilityState={{ disabled: !enabled }}
          accessibilityLabel="Playback position"
          accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
          onAccessibilityAction={(event) => {
            const step = event.nativeEvent.actionName === "increment" ? STEP_MS : -STEP_MS;
            const positionMs = extrapolatePosition(positionState.get(), Date.now());
            if (enabled) seekTo(Math.min(duration, Math.max(0, positionMs + step)), "scrubber");
          }}
          className="justify-center"
          style={{ height: CELL * 6 }}
          onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        >
          {width > 0 && (
            <Svg width={width} height={HEIGHT} pointerEvents="none">
              <AnimatedPath animatedProps={lineProps} stroke={tertiary} fill="none" />
              <AnimatedPath
                animatedProps={waveProps}
                transform={`translate(0 ${CENTRE - AMPLITUDE})`}
                stroke={accent}
                // Round ends cover the angle where the wave meets the line.
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </Svg>
          )}
        </Animated.View>
      </GestureDetector>
      <View className="flex-row justify-between">
        {/* Text reserves the original line box; the native values draw over it. */}
        <Animated.Text
          accessible={false}
          className="font-sans text-footnote text-secondary"
          style={[TABULAR, styles.placeholder]}
        >
          0:00
        </Animated.Text>
        <Animated.Text
          accessible={false}
          className="font-sans text-footnote text-secondary"
          style={[TABULAR, styles.placeholder]}
        >
          –:––
        </Animated.Text>
        <Animated.View pointerEvents="none" className="flex-row" style={StyleSheet.absoluteFill}>
          <AnimatedTextInput
            editable={false}
            accessibilityRole="text"
            underlineColorAndroid="transparent"
            animatedProps={elapsedProps}
            className="flex-1 font-sans text-footnote text-secondary"
            style={[TABULAR, styles.liveTime]}
          />
          <AnimatedTextInput
            editable={false}
            accessibilityRole="text"
            underlineColorAndroid="transparent"
            animatedProps={remainingProps}
            className="flex-1 font-sans text-footnote text-secondary"
            style={[TABULAR, styles.liveTime, styles.trailing]}
          />
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // A TextInput's own padding and box would move the digits off the Text's.
  liveTime: { padding: 0, margin: 0, textAlignVertical: "top" },
  placeholder: { opacity: 0 },
  trailing: { textAlign: "right" },
});
