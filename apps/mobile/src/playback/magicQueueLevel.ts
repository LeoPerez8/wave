import { readDiscoverMixLevel, type DiscoverMixLevel } from "@wave/core";

import { mixSlidersSetting } from "@/lib/mixSlidersSetting";
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

/**
 * The Magic Queue section's Genre faithfulness and Popularity sliders
 * (Core's `mixSlidersEngine`): how the engine ranks every Magic Queue's
 * YouTube Music candidates, from Home or any long-press menu, read again
 * for each batch.
 */
export const magicQueueSliders = mixSlidersSetting("home.magicQueueSliders");
