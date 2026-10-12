import { snapSliderValue } from "./slider.ts";

/**
 * How long a finger stays down before a long-press fires, in milliseconds.
 * The default is Android's own (about 500 ms), so nothing changes until the
 * listener picks a shorter delay in Settings.
 */
export const LONG_PRESS_DELAY = { min: 50, max: 500, step: 10, default: 500 } as const;

/** The delay nearest `ms` the setting can hold: clamped into the range and on a 10 ms step. */
export const snapLongPressDelay = (ms: number): number => snapSliderValue(ms, LONG_PRESS_DELAY);

/** The delay a stored setting stands for; nothing stored, or garbage, means the default. */
export const readLongPressDelay = (stored: string | null): number => {
  const ms = stored === null || stored.trim() === "" ? Number.NaN : Number(stored);
  return Number.isFinite(ms) ? snapLongPressDelay(ms) : LONG_PRESS_DELAY.default;
};
