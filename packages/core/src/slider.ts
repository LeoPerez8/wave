/**
 * A Settings slider's range: values run from `min` to `max` in steps of `step`
 * counted from `min` (`max` itself is always reachable).
 */
export interface SliderRange {
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

/** The value nearest `value` the slider can hold: clamped to the range and on a step. */
export const snapSliderValue = (value: number, range: SliderRange): number => {
  if (!Number.isFinite(value)) return range.min;
  const clamped = Math.min(range.max, Math.max(range.min, value));
  const stepped = range.min + Math.round((clamped - range.min) / range.step) * range.step;
  const onStep = Math.min(range.max, stepped);
  // Steps may not land on max; the end of the track still picks it.
  const nearest = Math.abs(range.max - clamped) < Math.abs(onStep - clamped) ? range.max : onStep;
  // Round off binary noise from fractional steps (0.1 + 0.2).
  return Number(nearest.toFixed(6));
};

/** Tolerance for binary noise when asking which step a value is on. */
const EPSILON = 1e-9;

/**
 * One step up (`1`) or down (`-1`) from `value`, as a screen reader's adjust
 * gesture does; stops at the ends.
 */
export const stepSlider = (value: number, direction: 1 | -1, range: SliderRange): number => {
  const steps = (snapSliderValue(value, range) - range.min) / range.step;
  const next =
    direction === 1 ? Math.floor(steps + EPSILON) + 1 : Math.ceil(steps - EPSILON) - 1;
  const stepped = Math.min(range.max, Math.max(range.min, range.min + next * range.step));
  return Number(stepped.toFixed(6));
};

/** How far along the track `value` sits, from 0 (min) to 1 (max). */
export const sliderFraction = (value: number, range: SliderRange): number => {
  const span = range.max - range.min;
  if (!(span > 0)) return 0;
  return Math.min(1, Math.max(0, (value - range.min) / span));
};

/** The value under a finger `x` dp from the start of a track `width` dp long. */
export const sliderValueAt = (x: number, width: number, range: SliderRange): number => {
  if (!(width > 0)) return range.min;
  return snapSliderValue(range.min + (x / width) * (range.max - range.min), range);
};
