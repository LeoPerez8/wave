import type { DiscoverMixLevel, MixRowId, MixSliders } from "@wave/core";

import { discoverLevel, discoverSliders } from "@/lib/discoverSettings";

import { refreshKnownVideos } from "./mixKnown";

/** Discover's mix rows, each with its own mixes and build. */
export type MixSectionId = MixRowId;

/** Every mix row: a slider move re-ranks them all. */
const MIX_ROWS: readonly MixSectionId[] = ["artist-mixes", "genre-mixes"];

let slidersListener: ((section: MixSectionId) => void) | null = null;

/** Discover's New music level; re-renders when it changes. */
export const useDiscoverLevel = (): DiscoverMixLevel => discoverLevel.useValue();

/**
 * Sets Discover's New music level: both mix rows re-blend their saved mixes
 * at once, offline, leaving out the new songs the owner has come to know
 * since the build; the next Magic Queue starts at its share.
 */
export const setDiscoverLevel = (value: DiscoverMixLevel): void => {
  refreshKnownVideos();
  discoverLevel.set(value);
};

/** Discover's Genre faithfulness and Popularity sliders now. */
export const discoverSlidersNow = (): MixSliders => discoverSliders.get();

/** Discover's sliders; re-renders when they change. */
export const useDiscoverSliders = (): MixSliders => discoverSliders.useValue();

/** Sets [listener] as what's told each mix row to re-rank when the sliders moved. */
export const setMixSlidersListener = (listener: (section: MixSectionId) => void): void => {
  slidersListener = listener;
};

/**
 * Sets Discover's sliders: both mix rows' saved mixes re-rank from the
 * catalog at once, offline, leaving out the new songs the owner has come to
 * know since the build; a Magic Queue applies them from its next batch.
 */
export const setDiscoverSliders = (value: MixSliders): void => {
  const before = discoverSliders.get();
  discoverSliders.set(value);
  if (discoverSliders.get() === before) return;
  refreshKnownVideos();
  for (const row of MIX_ROWS) slidersListener?.(row);
};
