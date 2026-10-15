import { readLongPressDelay, snapLongPressDelay } from "@wave/core";

import { persistedSetting } from "@/lib/persistedSetting";

export { LONG_PRESS_DELAY } from "@wave/core";

const longPressDelay = persistedSetting<number>({
  key: "settings.longPressDelayMs",
  synced: true,
  read: readLongPressDelay,
  write: String,
});

export const setLongPressDelayMs = (ms: number): void => longPressDelay.set(snapLongPressDelay(ms));

/** How long a finger stays down before a long-press fires; re-renders when Settings changes it. */
export const useLongPressDelayMs = longPressDelay.useValue;
