import type { ImportRing } from "@wave/core";
import { useEffect, type ReactNode } from "react";
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
import Svg, { Circle } from "react-native-svg";

import { useThemeColor } from "@/theme/useThemeColor";

import { CELL } from "./grid";

/** A cover up to this side (a list row's 40dp mosaic) takes the ring over its centre. */
const SMALL_COVER = CELL * 8;

/** The disc behind the ring: over a small cover's centre, else in a larger cover's corner. */
const SMALL_DISC = CELL * 3.5;
const DISC = CELL * 4;
const STROKE = 2.5;

/** One pulse, out and back: the ring dims to this and comes back. */
const PULSE_MS = 800;
const PULSE_LOW = 0.35;

/**
 * The ring itself, filling clockwise from the top over a faint track, on a
 * disc of the background, mostly opaque, so it reads over any cover.
 */
function Ring({ fraction, disc }: { fraction: number; disc: number }) {
  const [accent, secondary] = useThemeColor(["accent", "secondary"]);
  const size = disc - CELL;
  const radius = (size - STROKE) / 2;
  const length = 2 * Math.PI * radius;
  return (
    <Svg width={size} height={size} style={{ transform: [{ rotate: "-90deg" }] }}>
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke={secondary}
        strokeOpacity={0.3}
        strokeWidth={STROKE}
        fill="none"
      />
      {fraction > 0 && (
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={accent}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={`${length} ${length}`}
          strokeDashoffset={length * (1 - fraction)}
          fill="none"
        />
      )}
    </Svg>
  );
}

/** [children] dimming and coming back, gently and on repeat; still under Reduce motion. */
function Pulse({ children }: { children: ReactNode }) {
  const reduceMotion = useReducedMotion();
  const opacity = useSharedValue(1);
  useEffect(() => {
    if (reduceMotion) return;
    opacity.set(
      withRepeat(
        withTiming(PULSE_LOW, { duration: PULSE_MS, easing: Easing.inOut(Easing.quad) }),
        -1,
        true,
      ),
    );
    return () => {
      cancelAnimation(opacity);
      opacity.set(1);
    };
  }, [opacity, reduceMotion]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  return <Animated.View style={style}>{children}</Animated.View>;
}

/**
 * An importing playlist's ring over its cover, of side [cover] (Core's
 * `importRing`): over the centre of a list row's small mosaic, in the
 * bottom corner of a tile's, a large card's or the playlist page's. It
 * fills as the import goes, and pulses while matching. Place it inside a
 * box the size of the cover. Screen readers hear the progress from the
 * line beside it instead.
 */
export function CoverRing({ ring, cover }: { ring: ImportRing; cover: number }) {
  const small = cover <= SMALL_COVER;
  const disc = small ? SMALL_DISC : DISC;
  const place = small
    ? { top: (cover - disc) / 2, left: (cover - disc) / 2 }
    : { bottom: CELL, right: CELL };
  const drawn = <Ring fraction={ring.fraction} disc={disc} />;
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="absolute items-center justify-center rounded-full bg-background/85"
      style={{ ...place, width: disc, height: disc }}
    >
      {ring.pulses ? <Pulse>{drawn}</Pulse> : drawn}
    </View>
  );
}
