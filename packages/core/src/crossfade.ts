/**
 * Crossfade (Settings › Playback): how long a song ending on its own overlaps
 * the next one, both fading. The playback service plays the overlap; this is
 * the rule for when there is one.
 */

import type { SleepTimer } from "./sleepTimer.ts";
import { snapSliderValue } from "./slider.ts";

/** The Crossfade slider, in seconds. Zero, the default, keeps playback gapless. */
export const CROSSFADE = { min: 0, max: 10, step: 0.5, default: 0 } as const;

/** The setting nearest `seconds` the slider can hold. */
export const snapCrossfade = (seconds: number): number => snapSliderValue(seconds, CROSSFADE);

/** The stored setting (null when nothing is stored), back on the slider's range. */
export const readCrossfade = (stored: string | null): number => {
  const seconds = stored === null ? Number.NaN : Number(stored);
  return Number.isFinite(seconds) ? snapCrossfade(seconds) : CROSSFADE.default;
};

/**
 * How the player moves to another song: `natural` when the song ends on its
 * own, `repeat` when repeat one starts it over, `next`, `previous` and
 * `select` (picking a song) when the owner moves it.
 */
export type CrossfadeTransition = "natural" | "repeat" | "next" | "previous" | "select";

/**
 * The overlap, in ms, a transition plays with the setting at `seconds`; 0
 * switches at once (gapless). Only a song ending on its own into another
 * fades, and not while an end-of-song sleep timer runs: it stops after the
 * song, with nothing of the next one.
 */
export const crossfadeDuration = (
  seconds: number,
  transition: CrossfadeTransition,
  timer: SleepTimer | null,
): number => {
  if (transition !== "natural" || timer?.type === "endOfTrack") return 0;
  return snapCrossfade(seconds) * 1000;
};
