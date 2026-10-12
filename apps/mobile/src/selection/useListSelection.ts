import { isSelected, type Selection } from "@wave/core";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { addScreenBackHandler } from "@/overlay/back";
import type { ActionItems } from "@/playback/itemActions";

import {
  endSelectionOf,
  startSelection,
  toggleInSelection,
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
 */
export function useListSelection<T>({
  items,
  keyOf,
  target,
}: {
  items: readonly T[];
  keyOf: (item: T) => string;
  target: (selected: readonly T[]) => ActionItems;
}): ListSelection<T> {
  const owner = useRef({}).current;
  const latest = useRef({ items, keyOf, target });
  latest.current = { items, keyOf, target };
  const selection = useSelectionOf(owner);
  const selecting = selection !== null;

  const source = useMemo<SelectionSource<T>>(
    () => ({
      items: () => latest.current.items,
      keyOf: (item) => latest.current.keyOf(item),
      target: (selected) => latest.current.target(selected),
    }),
    [],
  );

  useEffect(() => () => endSelectionOf(owner), [owner]);

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

  return { selecting, selection, isChecked, start, toggle };
}
