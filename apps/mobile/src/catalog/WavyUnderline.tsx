import { UNDERLINE_WAVE, underlineMotion } from "@wave/core";
import { useReducedMotion } from "react-native-reanimated";

import { NativeWaveUnderline } from "@/glass/waveGlass";
import { usePlayWhenReady } from "@/playback/hooks";
import { useThemeColor } from "@/theme/useThemeColor";

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
 * motion.
 *
 * The ripple is a native AnimatedVectorDrawable on the RenderThread, not a
 * UI-thread animation: a UI-thread frame would make every glass view re-record
 * and re-blur its backdrop, even glass nowhere near the underline (issue #93).
 */
export function WavyUnderline() {
  const highlight = useThemeColor("highlight");
  const playing = usePlayWhenReady();
  const reduceMotion = useReducedMotion();
  const motion = underlineMotion({ isPlaying: playing, reduceMotion });

  return (
    <NativeWaveUnderline
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      color={highlight}
      animating={motion === "wriggle"}
      style={{ position: "absolute", left: 0, right: 0, bottom: -1, height: HEIGHT }}
    />
  );
}
