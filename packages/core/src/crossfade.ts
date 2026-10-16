/**
 * Crossfade (Settings › Playback): how long a song ending on its own overlaps
 * the next one, both fading. The playback service plays the overlap and
 * decides which song changes get one; this is the setting and its length.
 */

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
 * The overlap, in ms, for songs ending on their own with the setting at
 * `seconds`; 0 switches at once (gapless). The playback service decides which
 * changes fade: only a song ending on its own into another, never with repeat
 * one or an end-of-song sleep timer, and skip, previous or picking a song
 * switch at once.
 */
export const crossfadeDuration = (seconds: number): number => snapCrossfade(seconds) * 1000;
