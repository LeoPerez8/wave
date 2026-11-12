/**
 * Settings › Playback › Continue with Magic Queue: whether a queue that runs
 * out continues as a Magic Queue (`queueContinuation`'s `enabled`). On unless
 * the owner turned it off, so nothing stored reads as on.
 */
export const readContinueQueue = (stored: string | null): boolean => stored !== "off";

/** What the key-value store keeps for the switch: null at its default, on. */
export const writeContinueQueue = (on: boolean): string | null => (on ? null : "off");
