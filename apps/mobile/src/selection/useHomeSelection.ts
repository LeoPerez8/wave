import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { ActionItems } from "@/playback/actionTargets";
import { mixedItemKey, type MixedItem } from "@/playback/mixedItems";

import { currentSelection } from "./selection";
import { useListSelection } from "./useListSelection";

/**
 * One selection shared by Home's independently mounted sections. Each part
 * of Home that draws tiles reports them with `useHomeTiles`; Select All and
 * the actions take the tiles Home shows now, each as last drawn. A checked
 * tile that leaves Home (a mix refreshed away) stays checked as last seen.
 */
export function useHomeSelection() {
  // Each drawing part's tiles, in the order the parts first showed.
  const shown = useRef(new Map<object, readonly MixedItem[]>());
  const lastSeen = useRef(new Map<string, MixedItem>());
  const show = useCallback((part: object, items: readonly MixedItem[]) => {
    shown.current.set(part, items);
    for (const item of items) lastSeen.current.set(mixedItemKey(item), item);
  }, []);
  const hide = useCallback((part: object) => {
    shown.current.delete(part);
  }, []);
  const getItems = useCallback(() => {
    const byKey = new Map<string, MixedItem>();
    for (const items of shown.current.values())
      for (const item of items) {
        const key = mixedItemKey(item);
        if (!byKey.has(key)) byKey.set(key, lastSeen.current.get(key) ?? item);
      }
    return [...byKey.values()];
  }, []);
  const lookup = useCallback((key: string) => lastSeen.current.get(key), []);
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
  return useMemo(() => ({ ...selection, show, hide, enabled: true }), [selection, show, hide]);
}

export type HomeSelection = ReturnType<typeof useHomeSelection>;

/**
 * Reports the tiles a part of Home draws ([items], in its order) to Home's
 * selection while it shows them (nothing without a selection): drawn again,
 * they replace the part's last ones; gone from Home, they leave the
 * selection's list.
 */
export function useHomeTiles(
  selection: HomeSelection | undefined,
  items: readonly MixedItem[],
): void {
  const [part] = useState(() => ({}));
  const show = selection?.show;
  const hide = selection?.hide;
  useLayoutEffect(() => show?.(part, items));
  useLayoutEffect(() => () => hide?.(part), [part, hide]);
}
