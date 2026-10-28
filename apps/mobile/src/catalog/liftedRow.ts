/**
 * A lifted row's top on screen: under the finger ([top]). Kept inside a list
 * [viewport] tall, below [floor] (the sticky bar, or the first Up Next row's
 * slot under it), when there is one; a playlist's row (null) rides over the
 * head as it always did. [row] is a row's height.
 */
export const liftedTop = (
  top: number,
  viewport: number,
  floor: number | null,
  row: number,
): number => {
  "worklet";
  if (floor === null) return top;
  return Math.min(Math.max(floor, viewport - row), Math.max(floor, top));
};
