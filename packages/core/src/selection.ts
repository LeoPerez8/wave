/**
 * Selection: items checked in a list (songs, albums, artists, playlists…) so
 * one action can act on all of them. Items are known by a key that survives
 * re-sorting (their id), so changing a list's sort keeps the same items
 * selected. A selection is immutable: every change returns a new one.
 */

export interface Selection<K> {
  readonly keys: ReadonlySet<K>;
}

/** Nothing checked. */
export const NO_SELECTION: Selection<never> = { keys: new Set() };

/** A selection of these keys. */
export const selectionOf = <K>(keys: Iterable<K>): Selection<K> => ({ keys: new Set(keys) });

/**
 * Checks [key], or unchecks it when it is already checked. A selection
 * remembers the order its keys were checked in.
 */
export const toggleSelected = <K>(selection: Selection<K>, key: K): Selection<K> => {
  const keys = new Set(selection.keys);
  if (keys.has(key)) keys.delete(key);
  else keys.add(key);
  return { keys };
};

/** Unchecks everything. */
export const clearSelection = <K = never>(): Selection<K> => NO_SELECTION;

export const isSelected = <K>(selection: Selection<K>, key: K): boolean => selection.keys.has(key);

/** How many items are checked. */
export const selectedCount = (selection: Selection<unknown>): number => selection.keys.size;

/** Checks every item of [list]. */
export const selectAll = <T, K>(list: readonly T[], keyOf: (item: T) => K): Selection<K> =>
  selectionOf(list.map(keyOf));

/** Whether every item of a non-empty [list] is checked (and nothing else). */
export const allSelected = <T, K>(
  selection: Selection<K>,
  list: readonly T[],
  keyOf: (item: T) => K,
): boolean =>
  list.length > 0 &&
  selection.keys.size === list.length &&
  list.every((item) => selection.keys.has(keyOf(item)));

/**
 * The checked items of [list], in the list's order (not the order they were
 * checked in); items that left the list drop out.
 */
export const selectedInOrder = <T, K>(
  selection: Selection<K>,
  list: readonly T[],
  keyOf: (item: T) => K,
): T[] => list.filter((item) => selection.keys.has(keyOf(item)));

/**
 * [list] followed by the checked items that are no longer in it (found with
 * [lookup]), in the order they were checked: a list whose content changes
 * (search results as the query changes) keeps its checked items, and they act
 * after the ones it shows. Keys [lookup] doesn't know are left out.
 */
export const withSelectedKept = <T, K>(
  list: readonly T[],
  selection: Selection<K>,
  keyOf: (item: T) => K,
  lookup: (key: K) => T | undefined,
): T[] => {
  const shown = new Set(list.map(keyOf));
  const kept: T[] = [];
  for (const key of selection.keys) {
    if (shown.has(key)) continue;
    const item = lookup(key);
    if (item !== undefined) kept.push(item);
  }
  return kept.length === 0 ? [...list] : [...list, ...kept];
};
