import { readDiscoverMixLevel, type DiscoverMixLevel } from "@wave/core";

import { persistedSetting } from "@/lib/persistedSetting";

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

export const setDiscoverMixLevel = (value: DiscoverMixLevel): void => level.set(value);
