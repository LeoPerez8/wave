/**
 * The shuffle card (a long press on any shuffle button) explains each kind
 * of shuffle with a short line under its name: on every entry the first
 * times the card opens, then only on the entry under the sliding finger.
 */

/** How many openings of the shuffle card explain every kind. */
export const SHUFFLE_CARD_INTRO_OPENINGS = 3;

/**
 * How many times the shuffle card opened before, from what the device stores
 * (null when nothing is): anything but a whole count reads as never.
 */
export const readShuffleCardOpenings = (stored: string | null): number => {
  const count = stored === null || !/^\d+$/.test(stored) ? 0 : Number(stored);
  return Math.min(count, SHUFFLE_CARD_INTRO_OPENINGS);
};

/**
 * The count to store once the card opens, from the count before
 * ([openedBefore]). It stops where the card stops explaining every kind, so
 * later openings write nothing.
 */
export const shuffleCardOpened = (openedBefore: number): number =>
  Math.min(openedBefore + 1, SHUFFLE_CARD_INTRO_OPENINGS);

/** Whether the shuffle card shows entry [index]'s line. */
export const shuffleLineShows = (card: {
  /** How many times the card opened before this opening (`shuffleCardOpened`'s count). */
  readonly openedBefore: number;
  /** The entry the held finger rests on after sliding (slide to choose), if any. */
  readonly underFinger: number | undefined;
  readonly index: number;
}): boolean => card.openedBefore < SHUFFLE_CARD_INTRO_OPENINGS || card.index === card.underFinger;
