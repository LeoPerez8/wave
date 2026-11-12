import { readContinueQueue, writeContinueQueue } from "@wave/core";

import { persistedSetting } from "@/lib/persistedSetting";

/**
 * Continue with Magic Queue (Settings › Playback), on unless the owner turned
 * it off: a queue that runs out continues as a Magic Queue (Core's
 * `queueContinuation`). Off, it stops at its last song.
 */
const continueQueueSetting = persistedSetting<boolean>({
  key: "settings.continueQueue",
  synced: true,
  read: readContinueQueue,
  write: writeContinueQueue,
});

export const setContinueQueue = continueQueueSetting.set;

/** Whether a queue that runs out continues, read as each queue reaches its end. */
export const continueQueueOn = continueQueueSetting.get;

/** Follows the switch outside React, so turning it on reaches the queue playing now. */
export const onContinueQueue = continueQueueSetting.subscribe;

/** Whether the switch is on; re-renders when Settings or the Wave account changes it. */
export const useContinueQueue = continueQueueSetting.useValue;
