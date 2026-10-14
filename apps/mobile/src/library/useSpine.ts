import type { LegendListRef } from "@legendapp/list/react-native";
import { spineEntries, type IndexEntry } from "@wave/core";
import { useCallback, useMemo, type RefObject } from "react";

import { grid } from "@/catalog/grid";

const sameRow = (index: number): number => index;

/**
 * Wires the A–Z spine to a list ordered by Core sort key. `toRow` maps an item
 * index to the list row holding it (album grids put two items on a row).
 */
export const useSpine = (
  sortKeys: readonly string[],
  list: RefObject<LegendListRef | null>,
  toRow: (index: number) => number = sameRow,
): {
  readonly show: boolean;
  /** The spine's letters, each with the list row it starts on. */
  readonly entries: readonly IndexEntry[];
  /** Jumps the list to a letter's first row. */
  readonly onJump: (entry: IndexEntry) => void;
  /** The row at the top of the list on screen. */
  readonly topRow: () => number;
  /** The list's right padding: clear of the spine's touch target when it shows, the margin otherwise. */
  readonly paddingRight: number;
} => {
  const entries = useMemo(
    () => spineEntries(sortKeys).map((entry) => ({ ...entry, index: toRow(entry.index) })),
    [sortKeys, toRow],
  );
  const onJump = useCallback(
    (entry: IndexEntry) => {
      // A jump, not an animated scroll: scrolling through thousands of rows on
      // the way would render each of them and trail the finger.
      void list.current?.scrollToIndex({ index: entry.index, animated: false });
    },
    [list],
  );
  const topRow = useCallback(() => list.current?.getState().start ?? 0, [list]);
  const show = entries.length > 0;
  return {
    show,
    entries,
    onJump,
    topRow,
    paddingRight: show ? grid.spineHit + grid.spineInset : grid.margin,
  };
};
