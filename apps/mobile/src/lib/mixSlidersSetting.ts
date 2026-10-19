/**
 * A Home section's Genre faithfulness and Popularity sliders (Core's
 * `MixSliders`), kept on this phone (not synced): the mix sections' and the
 * Magic Queue's level cards each keep their own.
 */
import { readMixSliders, storedMixSliders, type MixSliders } from "@wave/core";

import { persistedSetting } from "./persistedSetting";

/** How long a dragged slider waits before it's written: the last step wins. */
const SLIDERS_PERSIST_MS = 500;

/** A section's Genre faithfulness and Popularity sliders, kept on this phone under [key]. */
export const mixSlidersSetting = (key: string) =>
  persistedSetting<MixSliders>({
    key,
    read: readMixSliders,
    write: storedMixSliders,
    equals: (a, b) => a.faithfulness === b.faithfulness && a.popularity === b.popularity,
    persistDelayMs: SLIDERS_PERSIST_MS,
  });
