import { readDiscoverMixLevel, type DiscoverMixLevel } from "@wave/core";

import { persistedSetting } from "@/lib/persistedSetting";

import { refreshKnownVideos } from "./mixKnown";

/**
 * How much of each Discover mix is new (Core's `DISCOVER_MIX_LEVELS`), one
 * level for every mix, kept on this phone (not synced: the mixes aren't).
 * Changing it re-blends the saved mixes at once, offline (`blendDiscoverMix`).
 */
const level = persistedSetting<DiscoverMixLevel>({
  key: "home.discoverMixLevel",
  read: readDiscoverMixLevel,
  write: String,
});

export const useDiscoverMixLevel = level.useValue;

/** Sets the level: the mixes re-blend, leaving out the new songs the owner has come to know since. */
export const setDiscoverMixLevel = (value: DiscoverMixLevel): void => {
  refreshKnownVideos();
  level.set(value);
};
