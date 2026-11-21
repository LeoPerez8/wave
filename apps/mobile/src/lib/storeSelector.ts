import { useMemo, useSyncExternalStore } from "react";

/** What a selector reads: an external store's `subscribe` and `get` (`makeExternalStore`). */
export interface Selectable<A> {
  readonly subscribe: (onChange: () => void) => () => void;
  readonly get: () => A;
}

/**
 * [store] narrowed to what [select] takes from it (#1423): `get` returns the
 * earlier slice while the store hasn't changed or the new slice [equals] it,
 * so `useSyncExternalStore` re-renders only when the slice itself changes.
 */
export const selectFrom = <A, B>(
  store: Selectable<A>,
  select: (value: A) => B,
  equals: (previous: B, next: B) => boolean = Object.is,
): Selectable<B> => {
  let read = false;
  let source: A;
  let slice: B;
  return {
    subscribe: store.subscribe,
    get: () => {
      const value = store.get();
      if (read && Object.is(value, source)) return slice;
      const next = select(value);
      source = value;
      if (!read || !equals(slice, next)) slice = next;
      read = true;
      return slice;
    },
  };
};

/**
 * The slice of [store] that [select] takes, re-rendering only when it changes
 * by [equals] (`Object.is` unless given; `shallowEqual` for a derived array or
 * object). [store], [select] and [equals] must be stable: module functions,
 * or memoized.
 */
export const useStoreSelector = <A, B>(
  store: Selectable<A>,
  select: (value: A) => B,
  equals?: (previous: B, next: B) => boolean,
): B => {
  const slice = useMemo(() => selectFrom(store, select, equals), [store, select, equals]);
  return useSyncExternalStore(slice.subscribe, slice.get);
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

/**
 * Arrays and plain objects compared item by item down to [depth] levels, and
 * everything below by identity: for a view derived afresh from a store (a
 * list's download state), equal when it would show the same.
 */
export const equalToDepth =
  (depth: number) =>
  (a: unknown, b: unknown): boolean => {
    if (Object.is(a, b)) return true;
    if (depth <= 0) return false;
    const inner = equalToDepth(depth - 1);
    if (Array.isArray(a) && Array.isArray(b))
      return a.length === b.length && a.every((item, index) => inner(item, b[index]));
    if (!isPlainObject(a) || !isPlainObject(b)) return false;
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => Object.hasOwn(b, key) && inner(a[key], b[key]))
    );
  };

/** Arrays item by item and plain objects key by key, each compared with `Object.is`. */
export const shallowEqual = equalToDepth(1);
