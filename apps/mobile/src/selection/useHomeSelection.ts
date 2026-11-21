import { useCallback, useMemo, useRef } from "react";

import type { ActionItems } from "@/playback/actionTargets";
import { mixedItemKey, type MixedItem } from "@/playback/mixedItems";

import { currentSelection } from "./selection";
import { useListSelection } from "./useListSelection";

/** One selection shared by Home's independently mounted sections. */
export function useHomeSelection() {
  const items = useRef<MixedItem[]>([]);
  const byKey = useRef(new Map<string, MixedItem>());
  const remember = useCallback((item: MixedItem): MixedItem => {
    const key = mixedItemKey(item);
    if (!byKey.current.has(key)) items.current.push(item);
    byKey.current.set(key, item);
    return item;
  }, []);
  const getItems = useCallback(() => items.current, []);
  const lookup = useCallback((key: string) => byKey.current.get(key), []);
  const target = useCallback((selected: readonly MixedItem[]): ActionItems => {
    const available = new Map(selected.map((item) => [mixedItemKey(item), item]));
    const ordered = [...currentSelection().keys].flatMap((key) => {
      const item = available.get(key);
      return item === undefined ? [] : [item];
    });
    return { kind: "mixed", items: ordered, readOnAction: true };
  }, []);
  const selection = useListSelection({
    items: getItems,
    keyOf: mixedItemKey,
    target,
    lookup,
  });

  // One object per selection change, as `useListSelection` gives, so memoized sections keep it.
  return useMemo(() => ({ ...selection, remember, enabled: true }), [selection, remember]);
}

export type HomeSelection = ReturnType<typeof useHomeSelection>;
