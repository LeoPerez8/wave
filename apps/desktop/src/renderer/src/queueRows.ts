import type { Page } from "../../shared/bridge.ts";
import type { QueueRow } from "../../shared/playerView.ts";

/**
 * The row of queue entry [at] among [pages], each [size] entries long and keyed by its number.
 * None when its page isn't loaded, or the entry's song is unknown and the page left it out.
 */
export const queueRowAt = (
  pages: ReadonlyMap<number, Page<QueueRow>>,
  size: number,
  at: number,
): QueueRow | undefined => {
  const items = pages.get(Math.floor(at / size))?.items;
  const straight = items?.[at % size];
  // A page with every song known holds each row at its own place.
  return straight?.at === at ? straight : items?.find((row) => row.at === at);
};
