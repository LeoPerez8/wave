import { underlineMotion } from "@wave/core";
import { useReducedMotion } from "react-native-reanimated";

import { NativeWaveUnderline } from "@/glass/waveGlass";
import { usePlayWhenReady } from "@/playback/hooks";
import { useTapAnimationMs } from "@/settings/tapAnimation";
import { useThemeColor } from "@/theme/useThemeColor";

/** Wavelength 8, amplitude 1.25 and stroke 1.25 dp live in the native tile (`wave_underline.xml`). */
const AMPLITUDE = 1.25;
const STROKE = 1.25;
/** Box tall enough for crest, trough and the stroke around them. */
const HEIGHT = AMPLITUDE * 2 + STROKE;

/**
 * The ember wave under the playing song's title. Lay it over the title's own
 * box (which hugs the visible, possibly truncated, text): it spans that width.
 * It ripples while music plays and lies still when paused, under reduce
 * motion, or with the tap animation at 0 ms.
 *
 * The ripple is a native AnimatedVectorDrawable on the RenderThread, not a
 * UI-thread animation: a UI-thread frame would make every glass view re-record
 * and re-blur its backdrop, even glass nowhere near the underline (issue #93).
 */
export function WavyUnderline() {
  const highlight = useThemeColor("highlight");
  const playing = usePlayWhenReady();
  const reduceMotion = useReducedMotion();
  const tapAnimationMs = useTapAnimationMs();
  const motion = underlineMotion({ isPlaying: playing, reduceMotion, tapAnimationMs });

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
