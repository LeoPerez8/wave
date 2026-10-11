import { Easing, FadeIn, Keyframe, ReduceMotion } from "react-native-reanimated";

/**
 * How content that a tap brings in arrives: it slides a short way from where
 * the tap points while it fades in, ease-out exponential, so it answers fast
 * and settles quietly. With reduce motion it only fades.
 */
export const ENTRY = {
  ease: Easing.out(Easing.exp),
  /** A tab switch slides this far from the side of the tapped tab. */
  slide: 32,
  slideMs: 280,
  /** Content that swaps in place rises this far. */
  rise: 8,
  riseMs: 220,
  /** The reduce-motion fade. */
  fadeMs: 150,
} as const;

/** Content swapping in place rises into it. */
export const rise = new Keyframe({
  0: { opacity: 0, transform: [{ translateY: ENTRY.rise }] },
  100: { opacity: 1, transform: [{ translateY: 0 }], easing: ENTRY.ease },
}).duration(ENTRY.riseMs);

/** The same arrival with reduce motion on: a short fade, nothing moves. */
export const riseReduced = FadeIn.duration(ENTRY.fadeMs).reduceMotion(ReduceMotion.Never);
