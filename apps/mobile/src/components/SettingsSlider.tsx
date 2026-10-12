import { sliderFraction, sliderValueAt, stepSlider, type SliderRange } from "@wave/core";
import * as Haptics from "expo-haptics";
import { useEffect, useRef } from "react";
import { Text, View } from "react-native";
import {
  GestureDetector,
  useExclusiveGestures,
  usePanGesture,
  useTapGesture,
} from "react-native-gesture-handler";

import { grid } from "@/catalog/grid";

type Props = {
  label: string;
  value: number;
  range: SliderRange;
  /** The value as shown next to the label and read out by screen readers, e.g. "140 ms". */
  format: (value: number) => string;
  /** Called with each new value while dragging (only when it lands on a different step). */
  onChange: (value: number) => void;
};

const THUMB = 24;
const TRACK = 4;
/** Horizontal movement that turns a touch into a drag; a vertical one stays with the list. */
const DRAG_SLOP = 6;

/**
 * Settings' slider: a label with its current value, over a track with a thumb.
 * Drag or tap the track to choose; values land on the range's steps.
 * Screen readers adjust it one step at a time.
 */
export function SettingsSlider({ label, value, range, format, onChange }: Props) {
  const width = useRef(0);
  const last = useRef(value);
  useEffect(() => {
    last.current = value;
  }, [value]);

  const choose = (next: number) => {
    if (next === last.current) return;
    last.current = next;
    void Haptics.selectionAsync();
    onChange(next);
  };
  // The thumb's centre travels between the track's ends, inset by half a thumb.
  const at = (x: number) => sliderValueAt(x - THUMB / 2, width.current - THUMB, range);

  const pan = usePanGesture({
    runOnJS: true,
    activeOffsetX: [-DRAG_SLOP, DRAG_SLOP],
    failOffsetY: [-DRAG_SLOP * 2, DRAG_SLOP * 2],
    onActivate: (event) => choose(at(event.x)),
    onUpdate: (event) => choose(at(event.x)),
  });
  const tap = useTapGesture({
    runOnJS: true,
    onActivate: (event) => choose(at(event.x)),
  });
  const gesture = useExclusiveGestures(pan, tap);

  const text = format(value);
  const fraction = sliderFraction(value, range);

  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min: range.min, max: range.max, now: value, text }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(event) =>
        onChange(stepSlider(value, event.nativeEvent.actionName === "increment" ? 1 : -1, range))
      }
      style={{ paddingTop: 12, paddingBottom: 4 }}
    >
      <View className="flex-row items-baseline">
        <Text className="flex-1 font-sans text-title3 font-normal text-foreground">{label}</Text>
        <Text
          className="font-sans text-body font-medium text-secondary"
          numberOfLines={1}
          style={{ fontVariant: ["tabular-nums"] }}
        >
          {text}
        </Text>
      </View>
      <GestureDetector gesture={gesture}>
        <View
          onLayout={(event) => {
            width.current = event.nativeEvent.layout.width;
          }}
          // The touch target is a full row tall; the drawn track is thin.
          style={{ height: grid.row - 8, justifyContent: "center" }}
        >
          <View
            className="rounded-full bg-fill"
            style={{ height: TRACK, marginHorizontal: THUMB / 2 }}
          >
            <View
              className="rounded-full bg-accent"
              style={{ height: TRACK, width: `${fraction * 100}%` }}
            />
          </View>
          <View
            pointerEvents="none"
            className="absolute rounded-full bg-accent"
            style={{
              width: THUMB,
              height: THUMB,
              left: `${fraction * 100}%`,
              marginLeft: -fraction * THUMB,
            }}
          />
        </View>
      </GestureDetector>
    </View>
  );
}
