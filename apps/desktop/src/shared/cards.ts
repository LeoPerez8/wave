/**
 * A shared card's image is at most a story's size, 1080 by 1920, as the phone shares it
 * (docs/spec.md, Recap and Sharing lyrics). A Recap story fills it; a lyrics or song card is
 * as tall as its content.
 */
export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1920;

/** Whether a card's image may be [width] by [height] pixels. */
export const cardSize = (width: number, height: number): boolean =>
  Number.isInteger(width) &&
  Number.isInteger(height) &&
  width >= 1 &&
  width <= CARD_WIDTH &&
  height >= 1 &&
  height <= CARD_HEIGHT;
