import { MAGIC_QUEUE_PICKS } from "./magicQueueSection.ts";
import type { RandomSource } from "./weightedPick.ts";

/**
 * What Discover's Magic Queue row draws from: the Library's songs with a
 * file, by id, and the YT Music entries of the owner's playlists, by video
 * id, each video once and none the Library already has as a file (that
 * song counts once, as the Library's). Unsearched and unavailable entries
 * have no video id and stay out.
 */
export interface MagicQueuePool {
  readonly trackIds: readonly number[];
  readonly videoIds: readonly string[];
}

/** A seed the row shows: a Library song's id (a number) or a YT Music entry's video id (a string). */
export type MagicQueueSeedId = number | string;

/**
 * Nine seeds uniformly random over the whole [pool], without replacement,
 * history or taste. Pass a live grid to keep its surviving seeds in place
 * while files and playlists change; omit it for a fresh draw whenever Home
 * opens or the owner refreshes.
 */
export const randomMagicQueuePicks = (
  pool: MagicQueuePool,
  random: RandomSource,
  previous: readonly MagicQueueSeedId[] = [],
): MagicQueueSeedId[] => {
  const available = new Set<MagicQueueSeedId>(pool.trackIds);
  for (const videoId of pool.videoIds) available.add(videoId);
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
