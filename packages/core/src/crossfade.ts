import type { SleepTimer } from "./sleepTimer.ts";
import { snapSliderValue } from "./slider.ts";

/** Settings › Playback, in seconds. Zero keeps the existing gapless player. */
export const CROSSFADE = { min: 0, max: 10, step: 0.5, default: 0 } as const;

/** The overlap a transition may use; manual changes always switch immediately. */
export const crossfadeDuration = (
  seconds: number,
  reason: "natural" | "next" | "previous" | "select",
  timer: SleepTimer | null,
): number => {
  if (reason !== "natural" || timer?.type === "endOfTrack") return 0;
  return snapSliderValue(Number.isFinite(seconds) ? seconds : CROSSFADE.default, CROSSFADE) * 1000;
};
