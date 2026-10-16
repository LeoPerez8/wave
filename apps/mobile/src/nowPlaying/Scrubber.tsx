import {
  UNDERLINE_WAVE,
  elapsedWavePath,
  formatDuration,
  formatRemaining,
  scrubPosition,
} from "@wave/core";
import * as Haptics from "expo-haptics";
import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Svg, { Path } from "react-native-svg";

import { CELL } from "@/catalog/grid";
import { perfCount, useRenderCount } from "@/perf/perf";
import { seekTo } from "@/playback/actions";
import { useThemeColor } from "@/theme/useThemeColor";

import { usePlayhead } from "./hooks";

/** How far a screen reader's increment / decrement moves the playhead. */
const STEP_MS = 10_000;

const BAR = 2;
const BAR_SCRUBBING = CELL / 2;
/** The playing-song underline's wave, scaled up (same wavelength : amplitude). */
const WAVELENGTH = CELL * 2;
const AMPLITUDE = (WAVELENGTH * UNDERLINE_WAVE.amplitude) / UNDERLINE_WAVE.wavelength;
/** Box tall enough for crest, trough and the boldest stroke around them. */
const HEIGHT = AMPLITUDE * 2 + BAR_SCRUBBING;

/**
 * The playhead: the elapsed part is a still teal wave, the shape of the
 * playing song's underline, that meets a flat graphite line at the playhead;
 * then elapsed and remaining time. Touch anywhere on it and drag to scrub;
 * the bar gets bolder and the track seeks when the finger lifts.
 */
export function Scrubber() {
  useRenderCount("Scrubber");
  const { positionMs, durationMs } = usePlayhead();
  const [width, setWidth] = useState(0);
  const [scrubMs, setScrubMs] = useState<number | null>(null);
  const duration = durationMs ?? 0;
  const enabled = duration > 0;
  const shownMs = Math.min(scrubMs ?? positionMs, duration);
  const fraction = enabled ? shownMs / duration : 0;
  const scrubbing = scrubMs !== null;

  // Memoised so scrubbing (a render per move) doesn't re-configure the gesture.
  const pan = usePanGesture(
    useMemo(() => {
      const at = (x: number) => scrubPosition({ x, width, durationMs: duration });
      return {
        runOnJS: true,
        enabled,
        minDistance: 0,
        onActivate: (event: { x: number }) => {
          perfCount("scrub.move");
          setScrubMs(at(event.x));
        },
        onUpdate: (event: { x: number }) => {
          perfCount("scrub.move");
          setScrubMs(at(event.x));
        },
        onDeactivate: (event: { x: number; canceled: boolean }) => {
          perfCount("scrub.release");
          if (!event.canceled) {
            seekTo(at(event.x));
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          }
          setScrubMs(null);
        },
      };
    }, [enabled, width, duration]),
  );

  const accent = useThemeColor("accent");
  const tertiary = useThemeColor("tertiary");
  const bar = scrubbing ? BAR_SCRUBBING : BAR;
  const join = fraction * width;
  const centre = HEIGHT / 2;

  return (
    <View>
      <GestureDetector gesture={pan}>
        <View
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="Playback position"
          accessibilityValue={{
            text: `${formatDuration(shownMs)} of ${formatDuration(duration)}`,
          }}
          accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
          onAccessibilityAction={(event) => {
            const step = event.nativeEvent.actionName === "increment" ? STEP_MS : -STEP_MS;
            if (enabled) seekTo(Math.min(duration, Math.max(0, positionMs + step)));
          }}
          className="justify-center"
          style={{ height: CELL * 4 }}
          onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        >
          {width > 0 && (
            <Svg width={width} height={HEIGHT} pointerEvents="none">
              {join < width && (
                <Path
                  d={`M${join} ${centre}H${width}`}
                  stroke={tertiary}
                  strokeWidth={bar}
                  fill="none"
                />
              )}
              {join > 0 && (
                <Path
                  d={elapsedWavePath({
                    length: join,
                    wavelength: WAVELENGTH,
                    amplitude: AMPLITUDE,
                  })}
                  transform={`translate(0 ${centre - AMPLITUDE})`}
                  stroke={accent}
                  strokeWidth={bar}
                  // Round ends cover the angle where the wave meets the line.
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              )}
            </Svg>
          )}
        </View>
      </GestureDetector>
      <View className="flex-row justify-between">
        <Text
          className="font-sans text-footnote text-secondary"
          style={{ fontVariant: ["tabular-nums"] }}
        >
          {formatDuration(shownMs)}
        </Text>
        <Text
          className="font-sans text-footnote text-secondary"
          style={{ fontVariant: ["tabular-nums"] }}
        >
          {enabled ? formatRemaining(shownMs, duration) : "–:––"}
        </Text>
      </View>
    </View>
  );
}
