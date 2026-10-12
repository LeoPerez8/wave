/**
 * Slide to choose: the finger that long-pressed a row stays down as the menu
 * opens, slides onto an entry, and lifting it there runs that entry. Decide
 * which entry that is.
 */

import type { OverlayRect } from "./overlay.ts";

/** A finger's position in the app window, in dp. */
export interface SlidePoint {
  readonly x: number;
  readonly y: number;
}

/** The finger held down since the long-press that opened the menu. */
export interface MenuSlide {
  /** Where the finger was when the menu opened. */
  readonly start: SlidePoint;
  /** It has slid further than the touch slop since; until then it chooses nothing. */
  readonly moved: boolean;
}

/** The finger that just long-pressed. */
export const startSlide = (start: SlidePoint): MenuSlide => ({ start, moved: false });

/** The finger moved to `point`; it has slid once it leaves `slop` dp of where it started. */
export const moveSlide = (slide: MenuSlide, point: SlidePoint, slop: number): MenuSlide =>
  slide.moved || Math.hypot(point.x - slide.start.x, point.y - slide.start.y) <= slop
    ? slide
    : { ...slide, moved: true };

const contains = (rect: OverlayRect, { x, y }: SlidePoint): boolean =>
  x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;

/**
 * The entry lifting the finger at `point` would run: the one under it, by
 * index into `entries` (their rects in the window; `undefined` where not laid
 * out yet). None until the finger has slid, and none outside `viewport` (the
 * window rect of the list holding them, where it scrolls inside the card).
 */
export const slideEntry = (
  slide: MenuSlide,
  point: SlidePoint,
  entries: readonly (OverlayRect | undefined)[],
  viewport?: OverlayRect,
): number | undefined => {
  if (!slide.moved || (viewport !== undefined && !contains(viewport, point))) return undefined;
  const index = entries.findIndex((rect) => rect !== undefined && contains(rect, point));
  return index === -1 ? undefined : index;
};

/**
 * Whether the finger moving from entry `previous` to entry `next` (indexes as
 * from `slideEntry`) should tick: it just moved onto an entry.
 */
export const slideTicks = (previous: number | undefined, next: number | undefined): boolean =>
  next !== undefined && next !== previous;
