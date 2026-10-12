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
}

export type OverlayAlign = "center" | "top";

export interface OverlayCardFrame {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  /** The tallest the card may be; taller content scrolls inside it. */
  readonly maxHeight: number;
}

/**
 * A card in the space between the system bars, a margin clear of everything:
 * centred, or a margin below the top bar when `align` is "top". An open
 * keyboard takes its height off the bottom of that space.
 */
export const placeOverlayCard = ({
  window,
  insets,
  margin,
  maxWidth,
  cardHeight,
  align = "center",
  keyboard = 0,
}: OverlayCardInput): OverlayCardFrame => {
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
