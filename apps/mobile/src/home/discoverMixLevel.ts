import {
  DISCOVER_MIX_LEVELS,
  MAGIC_QUEUE_LEVELS,
  readDiscoverMixLevel,
  type DiscoverMixLevel,
  type HomeSectionId,
  type MixSliders,
} from "@wave/core";

import { mixSlidersSetting } from "@/lib/mixSlidersSetting";
import { persistedSetting, type PersistedSetting } from "@/lib/persistedSetting";
import { magicQueueLevel, magicQueueSliders } from "@/playback/magicQueueLevel";

import { refreshKnownVideos } from "./mixKnown";

/** Home's mix sections, each with its own mixes, build and level. */
export type MixSectionId = Extract<HomeSectionId, "artist-mixes" | "genre-mixes">;

/** Home's sections with a level card in their header: the mix sections and the Magic Queue. */
export type LevelSectionId = MixSectionId | Extract<HomeSectionId, "magic-queue">;

/** A section's new-music steps, with the share each gives. */
type Levels = typeof DISCOVER_MIX_LEVELS;

/** What a section's level card sets, and what a move does beyond saving it. */
interface LevelSection {
  /**
   * How much of what it plays is new, kept on this phone (not synced). A
   * mix section's re-blends its saved mixes at once, offline
   * (`blendDiscoverMix`); the Magic Queue's sets the YouTube Music share its
   * queues start at (`magicQueueLevel`).
   */
  readonly level: PersistedSetting<DiscoverMixLevel>;
  /** Its new-music steps (Core's `DISCOVER_MIX_LEVELS`, `MAGIC_QUEUE_LEVELS`). */
  readonly levels: Levels;
  /**
   * Its Genre faithfulness and Popularity sliders (Core's `MixSliders`),
   * kept as the level is. A mix section's re-rank its saved mixes from the
   * catalog at once; the Magic Queue's apply from its next batch.
   */
  readonly sliders: PersistedSetting<MixSliders>;
  /** After its level moved. */
  readonly levelMoved: () => void;
  /** After its sliders moved. */
  readonly slidersMoved: () => void;
}

let slidersListener: ((section: MixSectionId) => void) | null = null;

const levelSetting = (key: string) =>
  persistedSetting<DiscoverMixLevel>({ key, read: readDiscoverMixLevel, write: String });

/**
 * A mix section's level card: a move leaves out of its mixes the new songs
 * the owner has come to know since the build; its sliders re-rank them
 * (`setMixSlidersListener`).
 */
const mixLevelSection = (id: MixSectionId, levelKey: string, slidersKey: string): LevelSection => ({
  level: levelSetting(levelKey),
  levels: DISCOVER_MIX_LEVELS,
  sliders: mixSlidersSetting(slidersKey),
  levelMoved: refreshKnownVideos,
  slidersMoved: () => {
    refreshKnownVideos();
    slidersListener?.(id);
  },
});

const SECTIONS: Record<LevelSectionId, LevelSection> = {
  // Artist mixes keeps Discover mixes' key, so its level carried over.
  "artist-mixes": mixLevelSection(
    "artist-mixes",
    "home.discoverMixLevel",
    "home.discoverMixSliders",
  ),
  "genre-mixes": mixLevelSection("genre-mixes", "home.genreMixLevel", "home.genreMixSliders"),
  // The Magic Queue reads both again when it starts a queue or picks a batch.
  "magic-queue": {
    level: magicQueueLevel,
    levels: MAGIC_QUEUE_LEVELS,
    sliders: magicQueueSliders,
    levelMoved: () => {},
    slidersMoved: () => {},
  },
};

/** The level of the section [section]; re-renders when it changes. */
export const useSectionLevel = (section: LevelSectionId): DiscoverMixLevel =>
  SECTIONS[section].level.useValue();

/** The share the section [section]'s level [level] gives ("60% new"). */
export const sectionLevelShare = (section: LevelSectionId, level: DiscoverMixLevel): string => {
  const { levels } = SECTIONS[section];
  return (levels.find((entry) => entry.level === level) ?? levels[0]!).share;
};

/**
 * Sets the level of the section [section]: a mix section's mixes re-blend,
 * leaving out the new songs the owner has come to know since the build.
 */
export const setSectionLevel = (section: LevelSectionId, value: DiscoverMixLevel): void => {
  SECTIONS[section].levelMoved();
  SECTIONS[section].level.set(value);
};

/** The sliders of the section [section] now. */
export const mixSlidersOf = (section: LevelSectionId): MixSliders =>
  SECTIONS[section].sliders.get();

/** The sliders of the section [section]; re-renders when they change. */
export const useMixSliders = (section: LevelSectionId): MixSliders =>
  SECTIONS[section].sliders.useValue();

/** Sets [listener] as what's told each mix section whose sliders moved: it re-ranks the section's mixes. */
export const setMixSlidersListener = (listener: (section: MixSectionId) => void): void => {
  slidersListener = listener;
};

/**
 * Sets the sliders of the section [section]: a mix section's saved mixes
 * re-rank from the catalog at once, offline, leaving out the new songs the
 * owner has come to know since the build; a Magic Queue applies them from
 * its next batch.
 */
export const setMixSliders = (section: LevelSectionId, value: MixSliders): void => {
  const { sliders, slidersMoved } = SECTIONS[section];
  const before = sliders.get();
  sliders.set(value);
  if (sliders.get() !== before) slidersMoved();
};
