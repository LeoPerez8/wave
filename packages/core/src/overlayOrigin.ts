/**
 * What an overlay card is about: the row, tile or button whose press opened
 * it. That element stays highlighted while its card (or a follow-up card) is
 * open, so it's clear what the card acts on.
 */

import type { OverlayRect } from "./overlay.ts";

/** A card on the overlay stack, as far as its origin goes. */
export interface OriginCard<O> {
  /** What the card was opened from; undefined when it wasn't opened from a press. */
  readonly origin: O | undefined;
  /** Fading out after a choice, Back or a tap outside. */
  readonly closing: boolean;
}

export interface NewCardInput<O> {
  /** The element whose press handler is opening the card, if one is. */
  readonly pressed: O | undefined;
  /** Kept by a card's choice across async work that ends in a follow-up card. */
  readonly held: O | undefined;
  /** The cards on the overlay, bottom to top. */
  readonly cards: readonly OriginCard<O>[];
}

/**
 * What a card that is opening is about: what its press pressed; else, as a
 * follow-up, what the choice that led to it held, or what the topmost card
 * (still fading out, if a choice just closed it) is about.
 */
export const originOfNewCard = <O>({ pressed, held, cards }: NewCardInput<O>): O | undefined =>
  pressed ?? held ?? cards.at(-1)?.origin;

/**
 * What is highlighted now: what the topmost open card is about. Nothing once
 * every card is on its way out, by whatever route it closed.
 */
export const highlightedOrigin = <O>(cards: readonly OriginCard<O>[]): O | undefined =>
  cards.findLast((card) => !card.closing)?.origin;

/**
 * Where a pressed element sits at rest, from where it measured while its press
 * feedback shrank it to `scale` about its centre, so its highlight covers the
 * whole row or tile rather than a slightly smaller one.
 */
export const restingRect = (measured: OverlayRect, scale: number): OverlayRect => {
  if (scale <= 0 || scale === 1) return measured;
  const x = (measured.left + measured.right) / 2;
  const y = (measured.top + measured.bottom) / 2;
  const halfWidth = (measured.right - measured.left) / 2 / scale;
  const halfHeight = (measured.bottom - measured.top) / 2 / scale;
  return { left: x - halfWidth, top: y - halfHeight, right: x + halfWidth, bottom: y + halfHeight };
};

export interface HighlightInput {
  /** The overlay's size: the window, or taller when drawing edge to edge. */
  readonly window: { readonly width: number; readonly height: number };
  readonly insets: { readonly bottom: number };
  /**
   * Floating chrome along the bottom (tab bar, mini player): its height above
   * the system inset, in dp; 0 when the screen has none.
   */
  readonly chromeBottom: number;
  /** Where the highlighted element sits at rest (`restingRect`); undefined when nothing is. */
  readonly rect: OverlayRect | undefined;
  /** It sits on the floating chrome (the selection bar's More), so the chrome doesn't hide it. */
  readonly onChrome?: boolean;
}

/**
 * The part of the highlighted element that shows: its rect cut to the window
 * and, unless it is part of the chrome, to the top of the floating chrome,
 * which floats above it. Undefined when none of it shows.
 */
export const visibleHighlight = ({
  window,
  insets,
  chromeBottom,
  rect,
  onChrome = false,
}: HighlightInput): OverlayRect | undefined => {
  if (rect === undefined) return undefined;
  const covered = chromeBottom > 0 && !onChrome;
  const floor = covered ? window.height - insets.bottom - chromeBottom : window.height;
  const left = Math.max(rect.left, 0);
  const top = Math.max(rect.top, 0);
  const right = Math.min(rect.right, window.width);
  const bottom = Math.min(rect.bottom, floor);
  return left < right && top < bottom ? { left, top, right, bottom } : undefined;
};

/**
 * The dimmed veil behind a card, as rects covering the window except where the
 * highlighted element sits, so it stays clear of the dimming: full-width bands
 * above and below it, and bands either side of it. Edges are cut to the window.
 */
export const veilAround = (
  window: { readonly width: number; readonly height: number },
  hole: OverlayRect | undefined,
): readonly OverlayRect[] => {
  const full = { left: 0, top: 0, right: window.width, bottom: window.height };
  if (hole === undefined) return [full];
  const left = Math.max(hole.left, 0);
  const right = Math.min(hole.right, window.width);
  const top = Math.max(hole.top, 0);
  const bottom = Math.min(hole.bottom, window.height);
  if (left >= right || top >= bottom) return [full];
  const bands = [
    { left: 0, top: 0, right: window.width, bottom: top },
    { left: 0, top: bottom, right: window.width, bottom: window.height },
    { left: 0, top, right: left, bottom },
    { left: right, top, right: window.width, bottom },
  ];
  return bands.filter((band) => band.right > band.left && band.bottom > band.top);
};

/**
 * Whether a card names the item it acts on in a heading (artwork, title,
 * subtitle). Not when the item it was opened from is highlighted above the
 * veil, which already says what the card is about; yes when nothing is (no
 * press opened it, or what was pressed sits off screen or under the floating
 * chrome).
 */
export const cardShowsHeading = (input: HighlightInput): boolean =>
  visibleHighlight(input) === undefined;
