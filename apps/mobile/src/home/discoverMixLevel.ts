import { readDiscoverMixLevel, type DiscoverMixLevel, type HomeSectionId } from "@wave/core";

import { persistedSetting } from "@/lib/persistedSetting";
import { magicQueueLevel } from "@/playback/magicQueueLevel";

import { refreshKnownVideos } from "./mixKnown";

/** Home's mix sections, each with its own mixes, build and level. */
export type MixSectionId = Extract<HomeSectionId, "artist-mixes" | "genre-mixes">;

/** Home's sections with a new-music level in their header: the mix sections and the Magic Queue. */
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
