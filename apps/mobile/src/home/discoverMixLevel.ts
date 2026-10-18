import { readDiscoverMixLevel, type DiscoverMixLevel, type HomeSectionId } from "@wave/core";

import { persistedSetting } from "@/lib/persistedSetting";

import { refreshKnownVideos } from "./mixKnown";

/** Home's mix sections, each with its own mixes, build and level. */
export type MixSectionId = Extract<HomeSectionId, "artist-mixes" | "genre-mixes">;

const levelSetting = (key: string) =>
  persistedSetting<DiscoverMixLevel>({ key, read: readDiscoverMixLevel, write: String });

/**
 * How much of each mix of a section is new (Core's `DISCOVER_MIX_LEVELS`),
 * one level per section, kept on this phone (not synced: the mixes aren't).
 * Artist mixes keeps Discover mixes' key, so its level carried over.
 * Changing it re-blends the section's saved mixes at once, offline
 * (`blendDiscoverMix`).
 */
const LEVELS: Record<MixSectionId, ReturnType<typeof levelSetting>> = {
  "artist-mixes": levelSetting("home.discoverMixLevel"),
  "genre-mixes": levelSetting("home.genreMixLevel"),
};

/** The level of the mix section [section]; re-renders when it changes. */
export const useDiscoverMixLevel = (section: MixSectionId): DiscoverMixLevel =>
  LEVELS[section].useValue();

/**
 * Sets the level of the mix section [section]: its mixes re-blend, leaving
 * out the new songs the owner has come to know since the build.
 */
export const setDiscoverMixLevel = (section: MixSectionId, value: DiscoverMixLevel): void => {
  refreshKnownVideos();
  LEVELS[section].set(value);
};
