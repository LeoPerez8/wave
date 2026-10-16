import { isSelected, withSelectedKept, type Selection } from "@wave/core";
import { useCallback, useEffect, useMemo, useState } from "react";

import { addScreenBackHandler } from "@/overlay/back";
import type { ActionItems } from "@/playback/actionTargets";

import {
  currentSelection,
  endSelectionOf,
  startSelection,
  toggleInSelection,
  updateSelectionSource,
  useSelectionOf,
  type SelectionSource,
} from "./selection";

export interface ListSelection<T> {
  /** This list is in selection mode: rows show check cells and taps toggle. */
  readonly selecting: boolean;
  /** The checked keys while selecting (for a list's `extraData`). */
  readonly selection: Selection<string> | null;
  readonly isChecked: (item: T) => boolean;
  /** Enters selection mode with [item] checked (the menu's Select). */
  readonly start: (item: T) => void;
  /** Checks or unchecks [item]; unchecking the last one leaves selection mode. */
  readonly toggle: (item: T) => void;
}

/**
 * Makes a list selectable: give it the items in the order it shows them, how
 * to key them (stable across sorts), and what the actions act on. Android
 * Back leaves selection mode, and so does the list going away.
 *
 * A list whose items come and go while selecting (Search, as the query
 * changes) gives `lookup`: checked items that leave it stay checked, and the
 * actions take them after the shown ones, in the order they were checked.
 */
export function useListSelection<T>({
  items,
  keyOf,
  target,
  lookup,
}: {
  items: readonly T[];
  keyOf: (item: T) => string;
  target: (selected: readonly T[]) => ActionItems | null;
  lookup?: ((key: string) => T | undefined) | undefined;
}): ListSelection<T> {
  // A stable identity for this list, which no other list can share.
  const [owner] = useState(() => ({}));
  const selection = useSelectionOf(owner);
  const selecting = selection !== null;

  const source = useMemo<SelectionSource<T>>(
    () => ({
      items:
        lookup === undefined
          ? () => items
          : () => withSelectedKept(items, currentSelection(), keyOf, lookup),
      keyOf,
      target,
    }),
    [items, keyOf, target, lookup],
  );

  useEffect(() => () => endSelectionOf(owner), [owner]);

  // A new sort (or a rescan) keeps the same items checked; the bar acts in the new order.
  useEffect(() => updateSelectionSource(owner, source), [owner, source]);

  useEffect(() => {
    if (!selecting) return;
    return addScreenBackHandler(() => {
      endSelectionOf(owner);
      return true;
    });
  }, [owner, selecting]);

  const start = useCallback(
    (item: T) => startSelection(owner, source, keyOf(item)),
    [owner, source, keyOf],
  );
  const toggle = useCallback((item: T) => toggleInSelection(keyOf(item)), [keyOf]);
  const isChecked = useCallback(
    (item: T) => selection !== null && isSelected(selection, keyOf(item)),
    [selection, keyOf],
  );

  // One object per change, so rows can depend on it (`selectableRow`).
  return useMemo(
    () => ({ selecting, selection, isChecked, start, toggle }),
    [selecting, selection, isChecked, start, toggle],
  );
}
