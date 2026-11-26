import { networkSignalHoldsUp, UNDERLINE_WAVE, underlineMotion } from "@wave/core";
import { useEffect } from "react";
import {
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { NativeWaveUnderline } from "@/glass/waveGlass";
import { usePlayWhenReady } from "@/playback/hooks";
import { useNetworkSignal } from "@/playback/networkSignal";
import { useThemeColor, type ThemeColor } from "@/theme/useThemeColor";

/**
 * How long the playing song's title and its underline take to step back to the
 * secondary colour while the network holds the song up, and to come back (#1498),
 * as Now Playing's cover loses its colour.
 */
export const HELD_UP_EASE_MS = 1000;

/**
 * Box tall enough for crest, trough and the stroke around them. The wave
 * itself lives in the native tile (`wave_underline.xml`), drawn from Core's
 * `UNDERLINE_WAVE` (`underlineDrawable.test.ts` keeps them in step).
 */
const HEIGHT = UNDERLINE_WAVE.amplitude * 2 + UNDERLINE_WAVE.stroke;

/**
 * The ember wave under the playing song's title. Lay it over the title's own
 * box (which hugs the visible, possibly truncated, text): it spans that width.
 * It ripples while music plays and lies still when paused, under reduce
 * motion, and while the network holds the song up (Offline or Slow, #1498),
 * when it eases to the secondary colour as the title does (`usePlayingTitleTone`).
 *
 * The ripple is a native AnimatedVectorDrawable on the RenderThread, not a
 * UI-thread animation: a UI-thread frame would make every glass view re-record
 * and re-blur its backdrop, even glass nowhere near the underline (issue #93).
 */
export function WavyUnderline() {
  const tone = usePlayingTitleTone();
  const colour = useThemeColor(tone);
  const playing = usePlayWhenReady();
  const reduceMotion = useReducedMotion();
  const motion = underlineMotion({ isPlaying: playing && tone === "highlight", reduceMotion });

  return (
    <NativeWaveUnderline
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      color={colour}
      colorEaseMs={reduceMotion ? 0 : HELD_UP_EASE_MS}
      animating={motion === "wriggle"}
      style={{ position: "absolute", left: 0, right: 0, bottom: -1, height: HEIGHT }}
    />
  );
}

/**
 * The playing song's title colour in lists: ember (highlight), or the
 * secondary colour while the network holds the song up (Offline or Slow).
 */
export const usePlayingTitleTone = (): "highlight" | "secondary" => {
  const { signal } = useNetworkSignal();
  return networkSignalHoldsUp(signal) ? "secondary" : "highlight";
};

/**
 * An animated text colour for the playing song's title: [tone] (ember in lists,
 * the foreground in Now Playing), easing to the secondary colour over
 * [HELD_UP_EASE_MS] while [heldUp], and back; at once under reduce motion.
 */
export function useHeldUpTitleStyle(tone: ThemeColor, heldUp: boolean) {
  const [base, secondary] = useThemeColor([tone, "secondary"]);
  const reduceMotion = useReducedMotion();
  const held = useSharedValue(heldUp ? 1 : 0);
  useEffect(() => {
    const to = heldUp ? 1 : 0;
    held.set(reduceMotion ? to : withTiming(to, { duration: HELD_UP_EASE_MS }));
  }, [heldUp, reduceMotion, held]);
  return useAnimatedStyle(() => ({
    color: interpolateColor(held.get(), [0, 1], [base, secondary]),
  }));
}

/** The playing song's title style in lists: ember, easing to secondary while held up. */
export function usePlayingTitleStyle() {
  return useHeldUpTitleStyle("highlight", usePlayingTitleTone() === "secondary");
}
