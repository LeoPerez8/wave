/**
 * The A–Z spine's rules: where each letter sits on it, which row a finger at
 * any height jumps to, and how screen-reader steps move through it.
 */

import { alphabetIndex, type IndexEntry } from "./browse.ts";

/** Every place on the spine, in the order `sortKey` files names: A to Z, then `#`. */
const ALPHABET: readonly string[] = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ", "#"];

/** Lists shorter than this fit in a couple of screens and go without a spine. */
const SPINE_MIN_ROWS = 24;

/**
 * The letters a list ordered by sort key shows on its spine, each with its
 * first row; none for a short list or one filed under a single letter.
 */
export const spineEntries = (sortKeys: readonly string[]): readonly IndexEntry[] => {
  if (sortKeys.length < SPINE_MIN_ROWS) return [];
  const entries = alphabetIndex(sortKeys);
  return entries.length > 1 ? entries : [];
};

/** One fixed place on the spine. */
export interface SpineSlot {
  /** The letter this place stands for, present in the list or not. */
  readonly letter: string;
  /**
   * Where a finger here jumps: this letter's first row when the list has it,
   * otherwise the next letter the list has (the last one, past the end).
   */
  readonly target: IndexEntry;
  /**
   * Drawn as its letter. Otherwise it is a dot: the list doesn't have the
   * letter, or there is only room to draw every other (or every third…) place.
   */
  readonly label: boolean;
}

/** How the spine is drawn in the space it has. */
export interface SpineLayout {
  /** The places, top to bottom. */
  readonly slots: readonly SpineSlot[];
  /** The height of one place, in dp. */
  readonly slotHeight: number;
  /** The spine's whole height, in dp. */
  readonly height: number;
}

/** What the spine has to fit in, in dp. */
export interface SpineSpace {
  /** The height free for the spine. */
  readonly space: number;
  /** The height a place takes when there is room for it. */
  readonly slotHeight: number;
  /** The height a drawn letter needs (Spine type's line height at the font scale). */
  readonly labelHeight: number;
}

/**
 * The spine for a list's letters (`alphabetIndex`): every letter in a fixed
 * place. A list without letters has no places.
 */
export const spineLayout = (
  entries: readonly IndexEntry[],
  { space, slotHeight, labelHeight }: SpineSpace,
): SpineLayout => {
  const first = entries[0];
  const last = entries.at(-1);
  if (first === undefined || last === undefined) return { slots: [], slotHeight: 0, height: 0 };
  const byLetter = new Map(entries.map((entry) => [entry.letter, entry]));
  // A list sorted Z to A runs the spine the same way.
  const descending = ALPHABET.indexOf(first.letter) > ALPHABET.indexOf(last.letter);
  const count = ALPHABET.length;
  const height = Math.max(0, Math.min(slotHeight, space / count));
  // How many places one drawn letter needs.
  const every = height > 0 ? Math.ceil(labelHeight / height) : count;
  const slots: SpineSlot[] = [];
  let next = last;
  // Walk from the end so each missing letter knows the next one present.
  for (let place = count - 1; place >= 0; place--) {
    const letter = ALPHABET[descending ? count - 1 - place : place]!;
    const present = byLetter.get(letter);
    next = present ?? next;
    slots.unshift({ letter, target: next, label: present !== undefined && place % every === 0 });
  }
  return { slots, slotHeight: height, height: height * count };
};

/**
 * The place a finger `y` dp below the spine's top is on. A finger above or
 * below the spine stays on its first or last place.
 */
export const spineSlotAt = (layout: SpineLayout, y: number): SpineSlot | undefined => {
  const { slots, slotHeight } = layout;
  if (slots.length === 0 || slotHeight <= 0) return undefined;
  const place = Math.min(slots.length - 1, Math.max(0, Math.floor(y / slotHeight)));
  return slots[place];
};

/** Where `entries` holds the letter row `row` is filed under; -1 for a list without letters. */
const sectionPlace = (entries: readonly IndexEntry[], row: number): number => {
  let place = entries.length === 0 ? -1 : 0;
  entries.forEach((entry, i) => {
    if (entry.index <= row) place = i;
  });
  return place;
};

/** The letter row `row` of the list is filed under, with that letter's first row. */
export const spineSection = (entries: readonly IndexEntry[], row: number): IndexEntry | undefined =>
  entries[sectionPlace(entries, row)];

/**
 * A screen reader's step on the spine: the letter after (1) or before (-1)
 * the one row `row` (the top of the list on screen) is filed under, staying on
 * the first or last letter past either end.
 */
export const spineStep = (
  entries: readonly IndexEntry[],
  row: number,
  direction: 1 | -1,
): IndexEntry | undefined => {
  const place = sectionPlace(entries, row);
  if (place < 0) return undefined;
  return entries[Math.min(entries.length - 1, Math.max(0, place + direction))];
};
