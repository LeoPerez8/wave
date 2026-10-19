import {
  parseOpenedRecaps,
  recapId,
  storedOpenedRecaps,
  withRecapOpened,
  type RecapPeriod,
} from "@wave/core";

import { persistedSetting } from "@/lib/persistedSetting";

const sameIds = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((id, index) => id === b[index]);

const openedRecaps = persistedSetting<readonly string[]>({
  key: "recaps.opened",
  read: parseOpenedRecaps,
  write: storedOpenedRecaps,
  equals: sameIds,
});

/** The `recapId`s opened so far; re-renders when one is opened. */
export const useOpenedRecaps = openedRecaps.useValue;

/** Keeps that `period`'s Recap was opened, so Home stops announcing it. */
export const markRecapOpened = (period: RecapPeriod): void =>
  openedRecaps.set(withRecapOpened(openedRecaps.get(), recapId(period)));
