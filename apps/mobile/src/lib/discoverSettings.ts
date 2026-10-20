/**
 * Discover's settings card (docs/spec.md, "Editable Home"): one New music
 * level and one pair of Genre faithfulness and Popularity sliders for the
 * Magic Queue, Artist mixes and Genre mixes, kept on this phone (not
 * synced). Keys of their own: the three sections' old values
 * (`home.discoverMixLevel`, `home.genreMixLevel`, `home.magicQueueLevel` and
 * their `…Sliders`) are left unread, so every value starts at its default.
 */
import {
  readDiscoverMixLevel,
  readMixSliders,
  storedMixSliders,
  type DiscoverMixLevel,
  type MixSliders,
} from "@wave/core";

import { persistedSetting } from "./persistedSetting";

/** How long a dragged slider waits before it's written: the last step wins. */
const SLIDERS_PERSIST_MS = 500;

/**
 * How much of what Discover plays is new (Core's `DISCOVER_MIX_LEVELS`): the
 * share of new songs each mix blends in (`blendDiscoverMix`), and the
 * YouTube Music share every Magic Queue starts at (`magicQueueShare`), from
 * Home or any long-press menu.
 */
export const discoverLevel = persistedSetting<DiscoverMixLevel>({
  key: "home.discoverLevel",
  read: readDiscoverMixLevel,
  write: String,
});

/**
 * Discover's Genre faithfulness and Popularity sliders (Core's
 * `mixSlidersEngine`): how the engine ranks the mixes, and every Magic
 * Queue's YouTube Music candidates, read again for each batch.
 */
export const discoverSliders = persistedSetting<MixSliders>({
  key: "home.discoverSliders",
  read: readMixSliders,
  write: storedMixSliders,
  equals: (a, b) => a.faithfulness === b.faithfulness && a.popularity === b.popularity,
  persistDelayMs: SLIDERS_PERSIST_MS,
});
