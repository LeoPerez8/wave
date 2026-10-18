/**
 * Wave's dialogs and menus float as glass cards over the app. Decide where a
 * card sits on screen, given its measured height.
 */

/** Four edges, in dp: how far in each one sits (insets), or where (a rect in the window). */
interface Edges {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

/** How far system bars (and cutouts) reach in from each edge of the window. */
export type OverlayInsets = Edges;

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
  /** Open next to this (a menu next to its row) rather than centred. */
  readonly anchor?: OverlayAnchor | undefined;
  /**
   * The system text size against the default (Android's font scale): larger
   * text makes a card's heading and entries taller, so an anchored card needs
   * more room beside its anchor. 1 when absent.
   */
  readonly textScale?: number | undefined;
}

/** A rectangle in the app window, in dp. */
export type OverlayRect = Edges;

export interface OverlayAnchor {
  /** What the card opens next to, e.g. the long-pressed row. */
  readonly rect: OverlayRect;
  /** Space kept between the card and the anchor, in dp. */
  readonly gap: number;
  /**
   * The shortest the card gets to stay beside the anchor when it fits on
   * neither side (its content scrolls), in dp at the default text size; it
   * grows in step with larger text (`textScale`). With less room than this on
   * both sides it covers the anchor instead. 0 when absent.
   */
  readonly minHeight?: number;
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
  /**
   * Which way a card's entries run, first to last: "down" from its top edge,
   * or "up" from its bottom edge, so the first one is always nearest the
   * finger that opened it.
   */
  readonly flow: OverlayFlow;
}

/** Which way a card's entries run, first to last. */
export type OverlayFlow = "down" | "up";

export interface CardKeyboard {
  /** Close the open keyboard as the card opens. */
  readonly closeKeyboard: boolean;
  /** The keyboard height to place the card with (`placeOverlayCard`'s `keyboard`), in dp. */
  readonly keyboard: number;
}

/**
 * What a card does with an open on-screen keyboard. Only a card someone types
 * into (`align` "top") keeps it. Any other card closes it as it opens, so the
 * first tap on an entry runs the entry rather than just closing the keyboard,
 * and lays out as if it were already gone so it doesn't jump when it goes.
 */
export const cardKeyboard = (input: {
  readonly align?: OverlayAlign | undefined;
  /** Height of the open keyboard, in dp; 0 when closed. */
  readonly keyboard: number;
}): CardKeyboard =>
  input.align === "top"
    ? { closeKeyboard: false, keyboard: input.keyboard }
    : { closeKeyboard: input.keyboard > 0, keyboard: 0 };

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
    flow: "down",
  };
};

/**
 * Below the anchor, or above it when the card wouldn't fit below; always a
 * margin clear of the system bars, but free to draw over the floating chrome
 * (tab bar, mini player, selection bar), as a centred card does. Too tall for
 * either side, it shrinks into the roomier one (down to the anchor's
 * `minHeight`, scaled with the text), so it never covers the anchor, nor the
 * finger holding it.
 */
const placeNextTo = (
  { window, insets, margin, maxWidth, cardHeight, textScale = 1 }: OverlayCardInput,
  { rect, gap, minHeight: leastHeight = 0 }: OverlayAnchor,
): OverlayCardFrame => {
  // A heading and a few entries, however large the text draws them (never smaller than usual).
  const minHeight = leastHeight * Math.max(1, textScale);
  const areaWidth = window.width - insets.left - insets.right;
  const width = Math.min(areaWidth - margin * 2, maxWidth);
  const highest = insets.top + margin;
  const lowest = window.height - insets.bottom - margin;
  // The card's edges beside the anchor, kept within the space it may use: a row reaching
  // into the gesture bar leaves no more room above it than the bar's top does, and a row
  // scrolled up under the status bar no more below it than the bar's foot does.
  const below = Math.max(rect.bottom + gap, highest);
  const above = Math.min(rect.top - gap, lowest);
  const roomBelow = lowest - below;
  const roomAbove = above - highest;
  const side =
    cardHeight <= roomBelow || (cardHeight > roomAbove && roomBelow >= roomAbove)
      ? "below"
      : "above";
  const room = side === "below" ? roomBelow : roomAbove;
  // Where even the roomier side is cramped, the card may use the whole height and cover the anchor.
  const maxHeight = cardHeight <= room || room >= minHeight ? room : lowest - highest;
  const height = Math.min(cardHeight, maxHeight);
  const top = Math.min(
    Math.max(side === "below" ? below : above - height, highest),
    lowest - height,
  );
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
    flow: side === "below" ? "down" : "up",
  };
};

/**
 * Whether entry `index` of a card's `count` entries (in their logical
 * order, first one nearest the finger) draws a hairline under it: every entry
 * but the one at the card's bottom edge, whichever way they run.
 */
export const entryDivider = (index: number, count: number, flow: OverlayFlow): boolean =>
  flow === "down" ? index < count - 1 : index > 0;

/**
 * A card's content height, for `placeOverlayCard`, from a fresh layout of it
 * (`laidOut`) under its `maxHeight`. A layout shorter than the limit is the
 * content's own height; one the limit cut short (to within a pixel) says only
 * that the content is at least that tall, so the taller height measured
 * before (`known`) still stands.
 */
export const cardContentHeight = (input: {
  /** The content height measured before, in dp. */
  readonly known: number;
  /** The card's height in this layout, in dp. */
  readonly laidOut: number;
  /** The tallest the card was allowed to be in that layout, in dp. */
  readonly maxHeight: number;
}): number =>
  input.laidOut < input.maxHeight - 1 ? input.laidOut : Math.max(input.known, input.laidOut);
