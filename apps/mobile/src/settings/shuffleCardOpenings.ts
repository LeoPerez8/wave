import { readShuffleCardOpenings, shuffleCardOpened } from "@wave/core";

import { persistedSetting } from "@/lib/persistedSetting";

/**
 * How many times the shuffle card has opened on this phone, up to the
 * openings that explain every kind (Core's `shuffleCardOpened`). Kept on the
 * device only: it never syncs with the Wave account.
 */
const openings = persistedSetting<number>({
  key: "shuffleCard.openings",
  read: readShuffleCardOpenings,
  write: (count) => (count === 0 ? null : String(count)),
});

/** Counts an opening of the shuffle card; gives how many openings came before it. */
export const countShuffleCardOpening = (): number => {
  const openedBefore = openings.get();
  openings.set(shuffleCardOpened(openedBefore));
  return openedBefore;
};
