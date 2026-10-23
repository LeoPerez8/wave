/** Shared synchronous/stepped algorithms. Generators expose work, without owning a scheduler. */
export const finishSteps = <A>(steps: Generator<void, A>): A => {
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
};
export function* mapSteps<A, B>(values: Iterable<A>, map: (value: A) => B): Generator<void, B[]> {
  const result: B[] = [];
  for (const value of values) {
    result.push(map(value));
    yield;
  }
  return result;
}
/** Stable merge sort: equal values keep their source order, as Array.sort does. */
export function* sortSteps<A>(
  values: readonly A[],
  compare: (a: A, b: A) => number,
): Generator<void, A[]> {
  let from = yield* mapSteps(values, (v) => v);
  let to: A[] = [];
  for (let width = 1; width < from.length; width *= 2) {
    for (let start = 0; start < from.length; start += width * 2) {
      let left = start,
        right = Math.min(start + width, from.length);
      const leftEnd = right,
        end = Math.min(start + width * 2, from.length);
      for (let at = start; at < end; at++) {
        to[at] =
          right >= end || (left < leftEnd && compare(from[left]!, from[right]!) <= 0)
            ? from[left++]!
            : from[right++]!;
        yield;
      }
    }
    [from, to] = [to, from];
  }
  return from;
}
export function* indexSteps<A, K, V>(
  values: Iterable<A>,
  entry: (value: A) => readonly [K, V],
): Generator<void, Map<K, V>> {
  const result = new Map<K, V>();
  for (const value of values) {
    const [key, item] = entry(value);
    result.set(key, item);
    yield;
  }
  return result;
}
