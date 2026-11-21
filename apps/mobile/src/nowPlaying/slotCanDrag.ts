import type { NowPlayingSlot } from "@wave/core";

/** An empty slot has no button to move. */
export const slotCanDrag = (action: NowPlayingSlot): boolean => action !== null;
