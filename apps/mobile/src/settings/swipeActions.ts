import {
  readSwipeSettings,
  storedSwipeSettings,
  type RowSwipeSide,
  type SwipeChoice,
  type SwipeSettings,
} from "@wave/core";

import { persistedSetting, sameFields } from "@/lib/persistedSetting";

/**
 * Settings › Swipe actions (docs/spec.md, "Swipe actions"): whether song rows
 * swipe, and what each direction runs. Synced with the Wave account.
 */
const swipeSettings = persistedSetting<SwipeSettings>({
  key: "settings.swipeActions",
  synced: true,
  read: readSwipeSettings,
  write: storedSwipeSettings,
  equals: sameFields,
});

/** The swipe settings as they are now, unfollowed: for a row's render and a swipe that runs. */
export const swipeSettingsNow = swipeSettings.get;

/**
 * The swipe settings; re-renders when they change (and only then), so a row
 * shows the directions they set.
 */
export const useSwipeSettings = swipeSettings.useValue;

/** Turns every song row's swipes on or off. */
export const setSwipesOn = (enabled: boolean): void =>
  swipeSettings.set({ ...swipeSettings.get(), enabled });

/** Sets what swiping towards [side] runs. */
export const setSwipeChoice = (side: RowSwipeSide, choice: SwipeChoice): void =>
  swipeSettings.set({ ...swipeSettings.get(), [side]: choice });
