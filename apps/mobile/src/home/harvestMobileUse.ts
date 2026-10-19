/**
 * The mobile data the harvest used today (docs/spec.md, "Discover",
 * harvest): about 5 MB a day (`HARVEST_MOBILE_BYTES`), which a Magic
 * Queue's refill counts in too. Kept on this phone (not synced), apart from
 * the harvest itself, so the Magic Queue's playback side reads it without
 * depending on Home's harvest.
 */
import {
  harvestMobileUsedToday,
  parseHarvestMobileUse,
  storedHarvestMobileUse,
  withHarvestMobileUse,
  type HarvestMobileUse,
} from "@wave/core";

import { persistedSetting } from "@/lib/persistedSetting";

const mobileUse = persistedSetting<HarvestMobileUse | null>({
  key: "home.harvestMobileUse",
  read: parseHarvestMobileUse,
  write: (use) => (use === null ? null : storedHarvestMobileUse(use)),
});

/** The mobile data the harvest used today, in bytes: a Magic Queue's refill counts in it too. */
export const harvestMobileUsed = (): number => harvestMobileUsedToday(mobileUse.get(), Date.now());

/** Counts [bytes] of mobile data the harvest (or a Magic Queue's refill) used now. */
export const noteHarvestMobileUse = (bytes: number): void => {
  mobileUse.set(withHarvestMobileUse(mobileUse.get(), bytes, Date.now()));
};
