import { currentLocalisation, useLocalisation } from "@/localisation/localisation";
import {
  GHOST_WAVE,
  UNDERLINE_WAVE,
  currentEntry,
  ghostWaveFrame,
  ghostWavePeriodMs,
  networkSignalLabel,
  elapsedWavePath,
  extrapolatePosition,
  formatDuration,
  formatRemaining,
  scrubHitSlop,
  scrubPosition,
} from "@wave/core";
import * as Haptics from "expo-haptics";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { StyleSheet, TextInput, View, type TextInputProps } from "react-native";
import {
  GestureDetector,
  useExclusiveGestures,
  usePanGesture,
  useTapGesture,
} from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
  createAnimatedComponent,
  Easing,
  useAnimatedProps,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import Svg, { Circle, G, Path, type CircleProps, type PathProps } from "react-native-svg";
import { scheduleOnRN, scheduleOnUI } from "react-native-worklets";
import { withUniwind } from "uniwind";

import { CELL } from "@/catalog/grid";
import { perfCount, useRenderCount } from "@/perf/perf";
import { seekTo } from "@/playback/actions";
import { useNetworkSignal } from "@/playback/networkSignal";
import { positionState } from "@/playback/Player";
import { queueState } from "@/playback/Queue";
import { useThemeColor } from "@/theme/useThemeColor";

import { playhead, usePlayheadDuration } from "./playhead";

/** How far a screen reader's increment / decrement moves the playhead. */
const STEP_MS = 10_000;

/** The touch box around the bar, in the layout. */
const TOUCH_HEIGHT = CELL * 6;
/** Grows the touch box to Core's grab reach beyond the layout, so nothing around it moves. */
const HIT_SLOP = scrubHitSlop(TOUCH_HEIGHT);

const BAR = 2;
const BAR_SCRUBBING = CELL / 2;
/** The playing-song underline's wave, scaled up (same wavelength : amplitude). */
const WAVELENGTH = CELL * 2;
const AMPLITUDE = (WAVELENGTH * UNDERLINE_WAVE.amplitude) / UNDERLINE_WAVE.wavelength;
/** Radius of the playhead's dot, at rest and under a finger (12 and 16 dp across). */
const DOT_RADIUS = CELL * 0.75;
const DOT_RADIUS_SCRUBBING = CELL;
/** Room past the biggest dot, so its anti-aliased edge isn't cut. */
const DOT_SLACK = 1;
/** Box tall enough for crest, trough and the boldest stroke around them, and for the biggest dot. */
const HEIGHT = Math.max(AMPLITUDE * 2 + BAR_SCRUBBING, (DOT_RADIUS_SCRUBBING + DOT_SLACK) * 2);
const CENTRE = HEIGHT / 2;
/**
 * How far the drawing reaches past each end of the bar, so a dot at 0:00 or
 * at the end is drawn whole.
 */
const OVERHANG = DOT_RADIUS_SCRUBBING + DOT_SLACK;

/** No ghost wave running. */
const NO_GHOST = -1;

/** No finger on the bar, or no release waiting for JavaScript. */
const NONE = -1;

const AnimatedPath = createAnimatedComponent(Path);
const AnimatedCircle = createAnimatedComponent(Circle);
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
 * playing song's underline, that meets a flat pewter line at the playhead,
 * where a teal dot sits; then elapsed and remaining time. Touch anywhere on it, or a little above or
 * below its box (Core's `scrubHitSlop`), and drag to scrub;
 * the bar gets bolder, the dot grows, and the track seeks when the finger lifts.
 * A tap seeks to the point it touched.
 *
 * The finger is followed on the UI thread: the bar and the times move with it
 * while JavaScript is busy, and JavaScript hears only the release, which it
 * seeks to. The release stays on screen until a render shows the seek.
 */
export function Scrubber() {
  const { strings } = useLocalisation();
  const ofTime = strings.playbackText.ofTime;
  useRenderCount("Scrubber");
  const durationMs = usePlayheadDuration();
  const entryKey = useSyncExternalStore(queueState.subscribe, playingKey);
  const [width, setWidth] = useState(0);
  const duration = durationMs ?? 0;
  const enabled = duration > 0;
  // The network signal (Ghost wave, #1498): the reason takes the time left's place, and a
  // ghost of the wave leaves the playhead and fades before it arrives.
  const { signal } = useNetworkSignal();
  const reasonText = networkSignalLabel(signal, strings);
  const reason = useSharedValue(reasonText ?? "");
  useLayoutEffect(() => reason.set(reasonText ?? ""), [reason, reasonText]);
  const periodMs = ghostWavePeriodMs(signal);
  const reduceMotion = useReducedMotion();
  const ghostPhase = useSharedValue(NO_GHOST);
  useEffect(() => {
    if (periodMs === null) {
      cancelAnimation(ghostPhase);
      ghostPhase.set(NO_GHOST);
      return;
    }
    if (reduceMotion) {
      ghostPhase.set(GHOST_WAVE.stillPhase);
      return;
    }
    ghostPhase.set(0);
    ghostPhase.set(withRepeat(withTiming(1, { duration: periodMs, easing: Easing.linear }), -1));
    return () => cancelAnimation(ghostPhase);
  }, [periodMs, reduceMotion, ghostPhase]);

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

  const at = useCallback(
    (x: number): number => {
      "worklet";
      const { width: barWidth, durationMs: barDuration } = bar.get();
      return scrubPosition({ x, width: barWidth, durationMs: barDuration });
    },
    [bar],
  );
  const pan = usePanGesture(
    useMemo(() => {
      return {
        enabled,
        hitSlop: HIT_SLOP,
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
    }, [enabled, at, entry, grabbed, scrub, released, commit]),
  );
  // The pan starts on the finger's first movement, so a finger that lifts
  // without moving never starts it: that touch is a tap, and seeks as a release does.
  const tap = useTapGesture(
    useMemo(
      () => ({
        enabled,
        hitSlop: HIT_SLOP,
        // A tap activates as the finger lifts.
        onActivate: (event: { x: number }) => {
          "worklet";
          const target = at(event.x);
          released.set(target);
          scheduleOnRN(commit, target, entry.get());
        },
      }),
      [enabled, at, entry, released, commit],
    ),
  );
  // A touch is one or the other, so it seeks once.
  const gesture = useExclusiveGestures(pan, tap);

  // The position on show: the finger's, a release's, or the playhead's.
  const shown = useDerivedValue(() => {
    const finger = scrub.get();
    const release = released.get();
    const ms = finger !== NONE ? finger : release !== NONE ? release : playhead.positionMs.get();
    return Math.min(ms, bar.get().durationMs);
  });
  const scrubbing = useDerivedValue(() => scrub.get() !== NONE);
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
      strokeWidth: scrubbing.get() ? BAR_SCRUBBING : BAR,
    };
  });
  const waveProps = useAnimatedProps<PathProps>(() => {
    const length = join.get();
    return {
      d:
        length > 0 ? elapsedWavePath({ length, wavelength: WAVELENGTH, amplitude: AMPLITUDE }) : "",
      strokeWidth: scrubbing.get() ? BAR_SCRUBBING : BAR,
    };
  });
  const ghostProps = useAnimatedProps<PathProps>(() => {
    const phase = ghostPhase.get();
    if (phase === NO_GHOST || scrubbing.get()) return { d: "", strokeOpacity: 0 };
    const frame = ghostWaveFrame({
      from: join.get(),
      to: bar.get().width,
      phase,
      wavelength: WAVELENGTH,
      amplitude: AMPLITUDE,
    });
    return { d: frame.d, strokeOpacity: frame.opacity };
  });
  const dotProps = useAnimatedProps<CircleProps>(() => ({
    cx: join.get(),
    // No length, no playhead to mark.
    r: bar.get().durationMs > 0 ? (scrubbing.get() ? DOT_RADIUS_SCRUBBING : DOT_RADIUS) : 0,
  }));

  // Native text props follow the same UI-thread position, including during a drag.
  const elapsedProps = useAnimatedProps(() => {
    const text = formatDuration(shown.get());
    return { text, defaultValue: text, accessibilityLabel: text } as TextInputProps;
  });
  const remainingProps = useAnimatedProps(() => {
    const length = bar.get().durationMs;
    const why = reason.get();
    const text = why !== "" ? why : length > 0 ? formatRemaining(shown.get(), length) : "–:––";
    return { text, defaultValue: text, accessibilityLabel: text } as TextInputProps;
  });
  const accessibilityProps = useAnimatedProps(() => {
    const why = reason.get();
    const time = `${formatDuration(shown.get())} ${ofTime} ${formatDuration(bar.get().durationMs)}`;
    return { accessibilityValue: { text: why === "" ? time : `${time}, ${why}` } };
  });

  const [accent, tertiary] = useThemeColor(["accent", "tertiary"]);

  return (
    <View>
      <GestureDetector gesture={gesture}>
        <Animated.View
          animatedProps={accessibilityProps}
          accessible
          accessibilityRole="adjustable"
          accessibilityState={{ disabled: !enabled }}
          accessibilityLabel={currentLocalisation().strings.playbackText.playbackPosition}
          accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
          onAccessibilityAction={(event) => {
            const step = event.nativeEvent.actionName === "increment" ? STEP_MS : -STEP_MS;
            const positionMs = extrapolatePosition(positionState.get(), Date.now());
            if (enabled) seekTo(Math.min(duration, Math.max(0, positionMs + step)), "scrubber");
          }}
          className="justify-center"
          style={{ height: TOUCH_HEIGHT }}
          onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        >
          {width > 0 && (
            <Svg
              width={width + OVERHANG * 2}
              height={HEIGHT}
              pointerEvents="none"
              style={{ marginHorizontal: -OVERHANG }}
            >
              <G transform={`translate(${OVERHANG} 0)`}>
                <AnimatedPath animatedProps={lineProps} stroke={tertiary} fill="none" />
                <AnimatedPath
                  animatedProps={ghostProps}
                  transform={`translate(0 ${CENTRE})`}
                  stroke={accent}
                  strokeWidth={BAR}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
                <AnimatedPath
                  animatedProps={waveProps}
                  transform={`translate(0 ${CENTRE - AMPLITUDE})`}
                  stroke={accent}
                  // Round ends cover the angle where the wave meets the line.
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
                <AnimatedCircle animatedProps={dotProps} cy={CENTRE} fill={accent} />
              </G>
            </Svg>
          )}
        </Animated.View>
      </GestureDetector>
      {/* The times take no touches, so the grab area's lower edge reaches the bar through them. */}
      <View pointerEvents="none" className="flex-row justify-between">
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
