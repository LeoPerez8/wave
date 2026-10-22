/**
 * Picking a few things at random, the heavier ones more often: the seeds of
 * Home's mixes, which change from build to build but lean towards what the
 * owner plays most.
 */

/** A random source as `Math.random` is one: each call a number from 0 up to (not including) 1. */
export type RandomSource = () => number;

/**
 * Up to [count] of [items], each once, picked one after another at random
 * from [random], each with a chance in proportion to its [weight] among those
 * not picked yet. In the order they were picked. Weights must be above 0.
 */
export const pickWeighted = <T>(
  items: readonly T[],
  count: number,
  weight: (item: T) => number,
  random: RandomSource,
): T[] => {
  const left = items.map((item) => ({ item, weight: weight(item) }));
  const picked: T[] = [];
  while (picked.length < count && left.length > 0) {
    const total = left.reduce((sum, entry) => sum + entry.weight, 0);
    let at = random() * total;
    let index = left.findIndex((entry) => (at -= entry.weight) < 0);
    // Rounding can leave a sliver past the last one: that's the last one.
    if (index === -1) index = left.length - 1;
    const [entry] = left.splice(index, 1);
    if (entry !== undefined) picked.push(entry.item);
  }
  return picked;
};

/**
 * How heavily a seed with [countedPlays] weighs in a pick: more plays weigh
 * more, but less than in proportion (the square root), so the few most
 * played don't take every pick. One with no plays still has a chance.
 */
export const playsWeight = (countedPlays: number): number =>
  Math.sqrt(Math.max(0, countedPlays) + 1);

/**
 * A random source that gives the same numbers for the same [key] every
 * time (mulberry32, seeded with the key's FNV-1a hash): a build's variety
 * made again, for a re-rank.
 */
export const seededRandom = (key: string): RandomSource => {
  let state = 0x81_1c_9d_c5;
  for (let index = 0; index < key.length; index++)
    state = Math.imul(state ^ key.charCodeAt(index), 0x01_00_01_93);
  return () => {
    state = (state + 0x6d_2b_79_f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
};

/** Same draws and floating point accumulation as pickWeighted, without an unbounded scan. */
export function* pickWeightedSteps<T>(
  items: readonly T[],
  count: number,
  weight: (item: T) => number,
  random: RandomSource,
): Generator<void, T[]> {
  const left: { item: T; weight: number; picked: boolean }[] = [];
  for (const item of items) {
    left.push({ item, weight: weight(item), picked: false });
    yield;
  }
  const picked: T[] = [];
  while (picked.length < count && picked.length < left.length) {
    let total = 0;
    for (const entry of left) {
      if (!entry.picked) total += entry.weight;
      yield;
    }
    let at = random() * total;
    let selected: (typeof left)[number] | undefined;
    for (const entry of left) {
      if (!entry.picked) {
        selected = entry;
        at -= entry.weight;
        if (at < 0) break;
      }
      yield;
    }
    if (selected === undefined) break;
    selected.picked = true;
    picked.push(selected.item);
    yield;
  }
  return picked;
}
