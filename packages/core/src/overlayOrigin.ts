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
