import { MAGIC_QUEUE_PICKS } from "./magicQueueSection.ts";
import type { RandomSource } from "./weightedPick.ts";

/**
 * Nine uniformly random Library ids, without replacement, history or taste.
 * Pass a live grid to keep its surviving songs in place while files change;
 * omit it for a fresh draw whenever Home opens or the owner refreshes.
 */
export const randomMagicQueuePicks = <T extends string | number>(
  trackIds: readonly T[],
  random: RandomSource,
  previous: readonly T[] = [],
): T[] => {
  const available = new Set(trackIds);
  const before = [...new Set(previous)].slice(0, MAGIC_QUEUE_PICKS);
  const kept = new Set(before.filter((id) => available.has(id)));
  const ids = [...available].filter((id) => !kept.has(id));
  const count = Math.min(MAGIC_QUEUE_PICKS, available.size) - kept.size;
  for (let place = 0; place < count; place++) {
    const other = place + Math.floor(random() * (ids.length - place));
    [ids[place], ids[other]] = [ids[other]!, ids[place]!];
  }
  const added = ids.slice(0, count);
  let next = 0;
  const picked = before.flatMap((id) =>
    available.has(id) ? [id] : next < added.length ? [added[next++]!] : [],
  );
  return [...picked, ...added.slice(next)];
};
