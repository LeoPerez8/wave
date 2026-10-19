import {
  readDiscoverMixLevel,
  readMixSliders,
  storedMixSliders,
  type DiscoverMixLevel,
  type MixSliders,
} from "@wave/core";

import { persistedSetting } from "@/lib/persistedSetting";

/**
 * The new-music level of Home's Magic Queue section (Core's
 * `MAGIC_QUEUE_LEVELS`): the YouTube Music share every Magic Queue starts
 * at (`magicQueueShare`), from Home or from any long-press menu. Kept on
 * this phone, as the mix sections' levels are.
 */
export const magicQueueLevel = persistedSetting<DiscoverMixLevel>({
  key: "home.magicQueueLevel",
  read: readDiscoverMixLevel,
  write: String,
});

/** How long a dragged slider waits before it's written: the last step wins. */
export const SLIDERS_PERSIST_MS = 500;

/** A section's Genre faithfulness and Popularity sliders, kept on this phone under [key]. */
export const mixSlidersSetting = (key: string) =>
  persistedSetting<MixSliders>({
    key,
    read: readMixSliders,
    write: storedMixSliders,
    equals: (a, b) => a.faithfulness === b.faithfulness && a.popularity === b.popularity,
    persistDelayMs: SLIDERS_PERSIST_MS,
  });

/**
 * The Magic Queue section's Genre faithfulness and Popularity sliders
 * (Core's `mixSlidersEngine`): how the engine ranks every Magic Queue's
 * YouTube Music candidates, from Home or any long-press menu, read again
 * for each batch.
 */
export const magicQueueSliders = mixSlidersSetting("home.magicQueueSliders");
