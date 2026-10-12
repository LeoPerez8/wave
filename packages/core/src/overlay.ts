/**
 * Wave's dialogs and menus float as glass cards over the app. Decide where a
 * card sits on screen, given its measured height.
 */

export interface OverlayInsets {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

export interface OverlayCardInput {
  /** The app window, in dp. */
  readonly window: { readonly width: number; readonly height: number };
  /** System bars (and cutouts) the card must stay clear of, in dp. */
  readonly insets: OverlayInsets;
  /** Gap kept between the card and the screen edges or system bars, in dp. */
  readonly margin: number;
  /** The card never grows wider than this, in dp (tablets, landscape). */
  readonly maxWidth: number;
  /** The card's laid-out content height, in dp. */
  readonly cardHeight: number;
  /**
   * Where the card sits: centred (the default), or near the top for a card
   * someone types into, so it stays put as the keyboard comes and goes.
   */
  readonly align?: OverlayAlign;
  /**
   * Height of an open on-screen keyboard, in dp, measured above the bottom
   * inset (Android reports it without the navigation bar). 0 or absent when closed.
   */
  readonly keyboard?: number;
  /**
   * Floating app chrome along the bottom (tab bar, mini player) an anchored
   * card stays clear of: its height above the system inset, in dp.
   */
  readonly chromeBottom?: number | undefined;
  /** Open next to this (a menu next to its row) rather than centred. */
  readonly anchor?: OverlayAnchor | undefined;
}

/** A rectangle in the app window, in dp. */
export interface OverlayRect {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

export interface OverlayAnchor {
  /** What the card opens next to, e.g. the long-pressed row. */
  readonly rect: OverlayRect;
  /** Space kept between the card and the anchor, in dp. */
  readonly gap: number;
}

export type OverlayAlign = "center" | "top";

export interface OverlayCardFrame {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  /** The tallest the card may be; taller content scrolls inside it. */
  readonly maxHeight: number;
  /** Which side of its anchor an anchored card opened on. */
  readonly side?: "below" | "above";
}

/**
 * A card in the space between the system bars, a margin clear of everything:
 * centred, or a margin below the top bar when `align` is "top". An open
 * keyboard takes its height off the bottom of that space. With an `anchor`,
 * next to it instead (`placeNextTo`).
 */
export const placeOverlayCard = (input: OverlayCardInput): OverlayCardFrame => {
  if (input.anchor !== undefined) return placeNextTo(input, input.anchor);
  const { window, insets, margin, maxWidth, cardHeight, align = "center", keyboard = 0 } = input;
  const areaWidth = window.width - insets.left - insets.right;
  const areaHeight = window.height - insets.top - insets.bottom - keyboard;
  const width = Math.min(areaWidth - margin * 2, maxWidth);
  const maxHeight = areaHeight - margin * 2;
  const height = Math.min(cardHeight, maxHeight);
  return {
    left: Math.round(insets.left + (areaWidth - width) / 2),
    top: Math.round(insets.top + (align === "top" ? margin : (areaHeight - height) / 2)),
    width,
    maxHeight,
  };
};

/**
 * Below the anchor, or above it when the card wouldn't fit below; always a
 * margin clear of the system bars and the floating chrome.
 */
const placeNextTo = (
  { window, insets, margin, maxWidth, cardHeight, chromeBottom = 0 }: OverlayCardInput,
  { rect, gap }: OverlayAnchor,
): OverlayCardFrame => {
  const areaWidth = window.width - insets.left - insets.right;
  const width = Math.min(areaWidth - margin * 2, maxWidth);
  const highest = insets.top + margin;
  const lowest = window.height - insets.bottom - chromeBottom - margin;
  const maxHeight = lowest - highest;
  const height = Math.min(cardHeight, maxHeight);
  const below = rect.bottom + gap;
  const above = rect.top - gap - height;
  // Where neither side has room, the roomier one wins and the card slides over the row.
  const side =
    below + height <= lowest || (above < highest && lowest - below >= rect.top - gap - highest)
      ? "below"
      : "above";
  const top = Math.min(Math.max(side === "below" ? below : above, highest), lowest - height);
  // Centred on the anchor where the card is narrower than the screen (tablets, landscape).
  const leftmost = insets.left + margin;
  const rightmost = window.width - insets.right - margin - width;
  const left = Math.min(Math.max((rect.left + rect.right - width) / 2, leftmost), rightmost);
  return {
    left: Math.round(left),
    top: Math.round(top),
    width,
    maxHeight,
    side,
  };
};
