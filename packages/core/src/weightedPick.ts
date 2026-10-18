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
