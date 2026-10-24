import {
  allSelected,
  NO_SELECTION,
  selectAll,
  selectedCount,
  selectedInOrder,
  selectionOf,
  toggleSelected,
  type Selection,
} from "@wave/core";
import { useMemo, useSyncExternalStore } from "react";

import { makeExternalStore } from "@/lib/externalStore";
import type { ActionItems } from "@/playback/actionTargets";

/**
 * Selection mode: one list at a time has checked items, and while it does the
 * chrome swaps the mini player and tab bar for the selection bar (and the
 * screen's top for "N selected"). The list owning the selection describes
 * itself with a `SelectionSource`; `useListSelection` does that for a list.
 */
export interface SelectionSource<T> {
  /** The list's items, in the order it shows them now (read when needed). */
  readonly items: () => readonly T[];
  /** An item's key: stable across sorts (its id). */
  readonly keyOf: (item: T) => string;
  /**
   * What the actions act on, given the checked items in list order; null while
   * the list still reads what they need (the bar shows once it has them).
   */
  readonly target: (selected: readonly T[]) => ActionItems | null;
}

interface SelectionState {
  /** The list selecting, or null outside selection mode. */
  readonly owner: object | null;
  readonly selection: Selection<string>;
  // Stored without its item type; only `owner`'s own hook writes it.
  readonly source: SelectionSource<unknown> | null;
}

const IDLE: SelectionState = { owner: null, selection: NO_SELECTION, source: null };

const state = makeExternalStore<SelectionState>(IDLE);

/** Starts selection mode for [owner]'s list with [key] checked. */
export const startSelection = <T>(owner: object, source: SelectionSource<T>, key: string): void =>
  state.set({
    owner,
    selection: selectionOf([key]),
    source: source as unknown as SelectionSource<unknown>,
  });

/** The checked keys now (empty outside selection mode). */
export const currentSelection = (): Selection<string> => state.get().selection;

/** Leaves selection mode (Done, Back, an action run, the list going away…). */
export const endSelection = (): void => state.set(IDLE);

/** Ends selection mode only if [owner] is the list selecting. */
export const endSelectionOf = (owner: object): void => {
  if (state.get().owner === owner) endSelection();
};

/** Checks or unchecks [key]; unchecking the last item leaves selection mode. */
export const toggleInSelection = (key: string): void => {
  const current = state.get();
  if (current.owner === null) return;
  const selection = toggleSelected(current.selection, key);
  state.set(selectedCount(selection) === 0 ? IDLE : { ...current, selection });
};

/** Checks every item of the selecting list. */
export const selectAllInList = (): void => {
  const { owner, source } = state.get();
  if (owner === null || source === null) return;
  state.update((current) => ({ ...current, selection: selectAll(source.items(), source.keyOf) }));
};

/**
 * [owner]'s list changed (re-sorted, say): the same items stay checked, and
 * what reads the list reads the new one.
 */
export const updateSelectionSource = <T>(owner: object, source: SelectionSource<T>): void => {
  if (state.get().owner === owner)
    state.update((current) => ({
      ...current,
      source: source as unknown as SelectionSource<unknown>,
    }));
};

const targetOf = ({ selection, source }: SelectionState): ActionItems | null =>
  source === null ? null : source.target(selectedInOrder(selection, source.items(), source.keyOf));

const useSelectionState = (): SelectionState => useSyncExternalStore(state.subscribe, state.get);

/** Whether any list is in selection mode (the chrome swaps itself for the selection bar). */
export const useIsSelecting = (): boolean =>
  useSyncExternalStore(state.subscribe, () => state.get().owner !== null);

/** The checked keys while [owner] is selecting, otherwise null. */
export const useSelectionOf = (owner: object): Selection<string> | null => {
  // Publishing the list's latest source must not render it again: its items may be derived anew.
  return useSyncExternalStore(state.subscribe, () => {
    const current = state.get();
    return current.owner === owner ? current.selection : null;
  });
};

/** "N selected" and whether Select All has anything left to check; null outside selection mode. */
export const useSelectionSummary = (): {
  readonly count: number;
  readonly all: boolean;
} | null => {
  const { owner, selection, source } = useSelectionState();
  if (owner === null || source === null) return null;
  return {
    count: selectedCount(selection),
    all: allSelected(selection, source.items(), source.keyOf),
  };
};

/** What the actions act on: the checked items in the list's order; null outside selection mode. */
export const useSelectedTarget = (): ActionItems | null => {
  const current = useSelectionState();
  return useMemo(() => targetOf(current), [current]);
};
