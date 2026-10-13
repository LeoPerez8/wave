import { Canvas, LinearGradient, Rect, vec } from "@shopify/react-native-skia";
import type { Gradient } from "@wave/core";
import { useEffect, useRef } from "react";
import { StyleSheet, useWindowDimensions } from "react-native";
import {
  Easing,
  interpolateColor,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnUI } from "react-native-worklets";

/** Long enough to read as a change of mood, not a flash. */
const CROSSFADE_MS = 700;

/**
 * The Now Playing ground: a top-to-bottom gradient from the artwork's palette
 * (already toned for legibility by Core's `paletteGradient`). On a track
 * change it crossfades from wherever it is to the new colours, even mid-fade;
 * out of sight (`animate` off) it changes straight away, so the sheet opens on
 * the right colours.
 */
export function Background({ gradient, animate }: { gradient: Gradient; animate: boolean }) {
  const { width, height } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  // Read when the colours change, so opening the sheet doesn't restart a fade.
  const animateRef = useRef(animate);
  useEffect(() => {
    animateRef.current = animate;
  }, [animate]);
  const fromTop = useSharedValue(gradient.top);
  const fromBottom = useSharedValue(gradient.bottom);
  const toTop = useSharedValue(gradient.top);
  const toBottom = useSharedValue(gradient.bottom);
  const progress = useSharedValue(1);

  const { top, bottom } = gradient;
  useEffect(() => {
    const instant = reduceMotion || !animateRef.current;
    scheduleOnUI(() => {
      "worklet";
      const p = progress.get();
      fromTop.set(interpolateColor(p, [0, 1], [fromTop.get(), toTop.get()]));
      fromBottom.set(interpolateColor(p, [0, 1], [fromBottom.get(), toBottom.get()]));
      toTop.set(top);
      toBottom.set(bottom);
      progress.set(0);
      progress.set(
        instant ? 1 : withTiming(1, { duration: CROSSFADE_MS, easing: Easing.inOut(Easing.quad) }),
      );
    });
  }, [top, bottom, reduceMotion, fromTop, fromBottom, toTop, toBottom, progress]);

  const colors = useDerivedValue(() => [
    interpolateColor(progress.get(), [0, 1], [fromTop.get(), toTop.get()]),
    interpolateColor(progress.get(), [0, 1], [fromBottom.get(), toBottom.get()]),
  ]);

  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <Rect x={0} y={0} width={width} height={height}>
        <LinearGradient start={vec(0, 0)} end={vec(0, height)} colors={colors} />
      </Rect>
    </Canvas>
  );
}
