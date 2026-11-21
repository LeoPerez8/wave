/**
 * A card's image: an element laid out at a story's size, drawn into a PNG the way the window
 * shows it. Save Image and Copy Image (`CardImageActions.tsx`) hand the PNG to main.
 */
import { cardSize } from "../../shared/cards.ts";

/**
 * A copy of [source] that carries its own look: every element's computed style, written on
 * the element, since the image is drawn outside the window's stylesheets.
 */
const withOwnStyles = (source: Element, copy: Element): void => {
  if (copy instanceof HTMLElement || copy instanceof SVGElement) {
    const computed = getComputedStyle(source);
    for (const name of computed)
      copy.style.setProperty(
        name,
        computed.getPropertyValue(name),
        computed.getPropertyPriority(name),
      );
  }
  for (let at = 0; at < source.children.length; at++)
    withOwnStyles(source.children[at]!, copy.children[at]!);
};

/** Waits for the card's pictures, so a cover still decoding isn't drawn as a blank. */
const picturesReady = (card: HTMLElement): Promise<unknown> =>
  Promise.all(
    [...card.querySelectorAll("img")].map((image) => image.decode().catch(() => undefined)),
  );

/**
 * [card] as a PNG in base64, at the size the card is laid out at: at most 1080 by 1920, and a
 * `transform` on it or an ancestor doesn't count. Its pictures must be `data:` addresses, as
 * `Artwork` loads them. Its animations are finished first, so the image shows it standing still.
 */
export const cardPng = async (card: HTMLElement): Promise<string> => {
  const width = card.offsetWidth;
  const height = card.offsetHeight;
  if (!cardSize(width, height)) throw new Error("The card is larger than a card's image");
  for (const animation of card.getAnimations({ subtree: true })) animation.finish();
  await picturesReady(card);
  const copy = card.cloneNode(true) as HTMLElement;
  withOwnStyles(card, copy);
  // The window may show the card scaled or moved; the image is the card itself.
  copy.style.setProperty("transform", "none");
  copy.style.setProperty("margin", "0");
  const markup = new XMLSerializer().serializeToString(copy);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%">${markup}</foreignObject></svg>`;
  const drawn = new Image();
  drawn.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await drawn.decode();
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("No canvas to draw the card on");
  context.drawImage(drawn, 0, 0, width, height);
  return canvas.toDataURL("image/png").slice("data:image/png;base64,".length);
};
