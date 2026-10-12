import { underlineMotion, wavePath } from "@wave/core";
import { useEffect, useState } from "react";
import { View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";

import { usePlayWhenReady } from "@/playback/hooks";
import { useTapAnimationMs } from "@/settings/tapAnimation";
import { useThemeColor } from "@/theme/useThemeColor";

const WAVELENGTH = 8;
const AMPLITUDE = 1.25;
const STROKE = 1.25;
/** Time for the wave to travel one wavelength. */
const PERIOD_MS = 700;
/** Box tall enough for crest, trough and the stroke around them. */
const HEIGHT = AMPLITUDE * 2 + STROKE;

/**
 * The ember wave under the playing song's title. Lay it over the title's own
 * box (which hugs the visible, possibly truncated, text): it spans that width.
 * It ripples on the UI thread while music plays and lies still when paused,
 * under reduce motion, or with the tap animation at 0 ms.
 */
export function WavyUnderline() {
  const highlight = useThemeColor("highlight");
  const playing = usePlayWhenReady();
  const reduceMotion = useReducedMotion();
  const tapAnimationMs = useTapAnimationMs();
  const motion = underlineMotion({ isPlaying: playing, reduceMotion, tapAnimationMs });
  const [width, setWidth] = useState(0);
  const shift = useSharedValue(0);

  useEffect(() => {
    if (motion === "wriggle") {
      // Carry on from where it stopped, one wavelength per period, forever.
      const from = shift.get() % WAVELENGTH;
      shift.set(from);
      shift.set(
        withRepeat(
          withTiming(from - WAVELENGTH, {
            duration: PERIOD_MS,
            easing: Easing.linear,
          }),
          -1,
        ),
      );
    } else {
      cancelAnimation(shift);
    }
    return () => cancelAnimation(shift);
  }, [motion, shift]);

  const style = useAnimatedStyle(() => ({ transform: [{ translateX: shift.get() }] }));

  return (
    <View
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      onLayout={(event) => setWidth(Math.ceil(event.nativeEvent.layout.width))}
      style={{ position: "absolute", left: 0, right: 0, bottom: -1, height: HEIGHT }}
      className="overflow-hidden"
    >
      {width > 0 && (
        <Animated.View style={[{ width: width + WAVELENGTH * 2 }, style]}>
          <Svg width={width + WAVELENGTH * 2} height={HEIGHT}>
            <Path
              d={wavePath({
                width: width + WAVELENGTH,
                wavelength: WAVELENGTH,
                amplitude: AMPLITUDE,
              })}
              transform={`translate(0 ${STROKE / 2})`}
              stroke={highlight}
              strokeWidth={STROKE}
              strokeLinecap="round"
              fill="none"
            />
          </Svg>
        </Animated.View>
      )}
    </View>
  );
}
