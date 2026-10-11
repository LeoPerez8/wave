import { formatDuration, formatRemaining, scrubPosition } from "@wave/core";
import * as Haptics from "expo-haptics";
import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";

import { CELL } from "@/catalog/grid";
import { seekTo } from "@/playback/actions";

import { usePlayhead } from "./hooks";

/** How far a screen reader's increment / decrement moves the playhead. */
const STEP_MS = 10_000;

const BAR = 2;
const BAR_SCRUBBING = CELL / 2;
const THUMB = CELL;
const THUMB_SCRUBBING = CELL * 2;

/**
 * The playhead: a thin graphite rule with the elapsed part in teal and a
 * small square thumb, then elapsed and remaining time. Touch anywhere on it
 * and drag to scrub; the track seeks when the finger lifts.
 */
export function Scrubber() {
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
        onActivate: (event: { x: number }) => setScrubMs(at(event.x)),
        onUpdate: (event: { x: number }) => setScrubMs(at(event.x)),
        onDeactivate: (event: { x: number; canceled: boolean }) => {
          if (!event.canceled) {
            seekTo(at(event.x));
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          }
          setScrubMs(null);
        },
      };
    }, [enabled, width, duration]),
  );

  const bar = scrubbing ? BAR_SCRUBBING : BAR;
  const thumb = scrubbing ? THUMB_SCRUBBING : THUMB;

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
          <View className="bg-tertiary" style={{ height: bar }}>
            <View className="bg-accent" style={{ height: bar, width: fraction * width }} />
          </View>
          {enabled && (
            <View
              className="absolute bg-accent"
              style={{
                width: thumb,
                height: thumb,
                left: Math.min(width - thumb, Math.max(0, fraction * width - thumb / 2)),
              }}
            />
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
