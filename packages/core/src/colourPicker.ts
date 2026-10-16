/**
 * The colour picker of Settings › Theme: a hue ring around a saturation and
 * brightness square, both drawn on a square canvas. This places them, finds
 * what a touch is on, turns a touch into a colour and places the markers.
 */

import type { Hsv } from "./colour.ts";

export interface ColourPickerLayout {
  /** The canvas's centre on both axes (it is `2 × centre` square). */
  readonly centre: number;
  /** The ring's middle line, from the centre. */
  readonly ringRadius: number;
  readonly ringWidth: number;
  readonly square: { readonly left: number; readonly top: number; readonly side: number };
}

/** What a touch adjusts: the hue (ring) or the saturation and brightness (square). */
export type ColourPickerTarget = "ring" | "square";

/** The ring's width and the clear space inside it, as shares of the canvas. */
const RING_SHARE = 0.1;
const GAP_SHARE = 0.08;
/** How far outside a part a touch still lands on it, as a share of the ring's width. */
const SLOP_SHARE = 0.2;

/** The picker on a `size`-wide square canvas. */
export const colourPickerLayout = (size: number): ColourPickerLayout => {
  const centre = size / 2;
  const ringWidth = size * RING_SHARE;
  const ringRadius = centre - ringWidth / 2;
  const half = (ringRadius - ringWidth / 2 - size * GAP_SHARE) / Math.SQRT2;
  return {
    centre,
    ringRadius,
    ringWidth,
    square: { left: centre - half, top: centre - half, side: 2 * half },
  };
};

/** What a touch starting at (`x`, `y`) on the canvas adjusts; null when it misses both. */
export const colourPickerTarget = (
  layout: ColourPickerLayout,
  x: number,
  y: number,
): ColourPickerTarget | null => {
  const slop = layout.ringWidth * SLOP_SHARE;
  const distance = Math.hypot(x - layout.centre, y - layout.centre);
  if (Math.abs(distance - layout.ringRadius) <= layout.ringWidth / 2 + slop) return "ring";
  const { left, top, side } = layout.square;
  const inside = (value: number, start: number) =>
    value >= start - slop && value <= start + side + slop;
  return inside(x, left) && inside(y, top) ? "square" : null;
};

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * The colour after a touch at (`x`, `y`) on `target`, from `hsv`. On the ring
 * the angle is the hue, red to the right and going clockwise; in the square
 * saturation grows to the right and brightness upward, held to its edges.
 */
export const pickColour = (
  layout: ColourPickerLayout,
  target: ColourPickerTarget,
  x: number,
  y: number,
  hsv: Hsv,
): Hsv => {
  if (target === "ring") {
    const angle = (Math.atan2(y - layout.centre, x - layout.centre) * 180) / Math.PI;
    return { ...hsv, h: (angle + 360) % 360 };
  }
  const { left, top, side } = layout.square;
  return { h: hsv.h, s: clamp01((x - left) / side), v: clamp01(1 - (y - top) / side) };
};

/** Where the ring's marker (the hue) and the square's (the shade) sit for `hsv`. */
export const colourPickerMarkers = (
  layout: ColourPickerLayout,
  hsv: Hsv,
): {
  readonly ring: { readonly x: number; readonly y: number };
  readonly square: { readonly x: number; readonly y: number };
} => {
  const angle = (hsv.h * Math.PI) / 180;
  const { left, top, side } = layout.square;
  return {
    ring: {
      x: layout.centre + layout.ringRadius * Math.cos(angle),
      y: layout.centre + layout.ringRadius * Math.sin(angle),
    },
    square: { x: left + clamp01(hsv.s) * side, y: top + (1 - clamp01(hsv.v)) * side },
  };
};
