import {
  readDiscoverMixLevel,
  type DiscoverMixLevel,
  type HomeSectionId,
  type MixSliders,
} from "@wave/core";

import { persistedSetting } from "@/lib/persistedSetting";
import { magicQueueLevel, magicQueueSliders, mixSlidersSetting } from "@/playback/magicQueueLevel";

import { refreshKnownVideos } from "./mixKnown";

/** Home's mix sections, each with its own mixes, build and level. */
export type MixSectionId = Extract<HomeSectionId, "artist-mixes" | "genre-mixes">;

/** Home's sections with a level card in their header: the mix sections and the Magic Queue. */
export type LevelSectionId = MixSectionId | Extract<HomeSectionId, "magic-queue">;

const levelSetting = (key: string) =>
  persistedSetting<DiscoverMixLevel>({ key, read: readDiscoverMixLevel, write: String });

/**
 * How much of each mix of a section is new (Core's `DISCOVER_MIX_LEVELS`),
 * one level per section, kept on this phone (not synced: the mixes aren't).
 * Artist mixes keeps Discover mixes' key, so its level carried over.
 * Changing it re-blends the section's saved mixes at once, offline
 * (`blendDiscoverMix`). The Magic Queue's sets the YouTube Music share its
 * queues start at (`magicQueueLevel`).
 */
const LEVELS: Record<LevelSectionId, ReturnType<typeof levelSetting>> = {
  "artist-mixes": levelSetting("home.discoverMixLevel"),
  "genre-mixes": levelSetting("home.genreMixLevel"),
  "magic-queue": magicQueueLevel,
};

/**
 * Each section's Genre faithfulness and Popularity sliders (Core's
 * `MixSliders`), kept on this phone (not synced), as the level is. A mix
 * section's re-rank its saved mixes from the catalog at once
 * (`onMixSlidersMoved`); the Magic Queue's apply from its next batch.
 */
const SLIDERS: Record<LevelSectionId, ReturnType<typeof mixSlidersSetting>> = {
  "artist-mixes": mixSlidersSetting("home.discoverMixSliders"),
  "genre-mixes": mixSlidersSetting("home.genreMixSliders"),
  "magic-queue": magicQueueSliders,
};

/** The level of the section [section]; re-renders when it changes. */
export const useDiscoverMixLevel = (section: LevelSectionId): DiscoverMixLevel =>
  LEVELS[section].useValue();

/**
 * Sets the level of the section [section]: a mix section's mixes re-blend,
 * leaving out the new songs the owner has come to know since the build.
 */
export const setDiscoverMixLevel = (section: LevelSectionId, value: DiscoverMixLevel): void => {
  if (section !== "magic-queue") refreshKnownVideos();
  LEVELS[section].set(value);
};

/** The sliders of the section [section] now. */
export const mixSlidersOf = (section: LevelSectionId): MixSliders => SLIDERS[section].get();

/** The sliders of the section [section]; re-renders when they change. */
export const useMixSliders = (section: LevelSectionId): MixSliders => SLIDERS[section].useValue();

let moved: ((section: MixSectionId) => void) | null = null;

/** Tells [listener] each mix section whose sliders moved: it re-ranks the section's mixes. */
export const onMixSlidersMoved = (listener: (section: MixSectionId) => void): void => {
  moved = listener;
};

/**
 * Sets the sliders of the section [section]: a mix section's saved mixes
 * re-rank from the catalog at once, offline, leaving out the new songs the
 * owner has come to know since the build; a Magic Queue applies them from
 * its next batch.
 */
export const setMixSliders = (section: LevelSectionId, value: MixSliders): void => {
  const setting = SLIDERS[section];
  const before = setting.get();
  setting.set(value);
  if (section === "magic-queue" || setting.get() === before) return;
  refreshKnownVideos();
  moved?.(section);
};
