import type { LegendListRef } from "@legendapp/list/react-native";
import { alphabetIndex } from "@wave/core";
import { useCallback, useMemo, type RefObject } from "react";

import { grid } from "@/catalog/grid";

/** Lists shorter than this fit in a couple of screens and go without a spine. */
export const SPINE_MIN_ITEMS = 24;

/**
 * Wires the A–Z spine to a list ordered by Core sort key. `toRow` maps an item
 * index to the list row holding it (album grids put two items on a row).
 */
export const useSpine = (
  sortKeys: readonly string[],
  list: RefObject<LegendListRef | null>,
  toRow: (index: number) => number = (index) => index,
): {
  readonly show: boolean;
  readonly letters: readonly string[];
  readonly onLetter: (letter: string) => void;
  /** The list's right padding: clear of the spine when it shows, the margin otherwise. */
  readonly paddingRight: number;
} => {
  const entries = useMemo(
    () => (sortKeys.length >= SPINE_MIN_ITEMS ? alphabetIndex(sortKeys) : []),
    [sortKeys],
  );
  const letters = useMemo(() => entries.map((entry) => entry.letter), [entries]);
  const onLetter = useCallback(
    (letter: string) => {
      const entry = entries.find((candidate) => candidate.letter === letter);
      if (entry === undefined) return;
      void list.current?.scrollToIndex({ index: toRow(entry.index), animated: false });
    },
    [entries, list, toRow],
  );
  const show = entries.length > 1;
  return {
    show,
    letters,
    onLetter,
    paddingRight: show ? grid.spine + grid.spineInset : grid.margin,
  };
};
