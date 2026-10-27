import { useMemo } from "react";

/**
 * Each item's index in [items], found by the item itself or by [keyOf] of it
 * (a module-level function, so the map is rebuilt only when [items] changes).
 */
export function usePositions<T>(items: readonly T[]): ReadonlyMap<T, number>;
export function usePositions<T, K>(
  items: readonly T[],
  keyOf: (item: T) => K,
): ReadonlyMap<K, number>;
export function usePositions<T, K>(
  items: readonly T[],
  keyOf?: (item: T) => K,
): ReadonlyMap<T | K, number> {
  return useMemo(
    () =>
      new Map<T | K, number>(
        items.map((item, index) => [keyOf === undefined ? item : keyOf(item), index]),
      ),
    [items, keyOf],
  );
}
