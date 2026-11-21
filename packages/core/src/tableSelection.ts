import { toggleSelected } from "./selection.ts";

/** A table's checked keys, or the unchecked keys after Select All. */
export interface TableSelection<K = number> {
  readonly all: boolean;
  readonly ids: ReadonlySet<K>;
  readonly checkboxes: boolean;
}

export const tableSelectionOf = <K>(ids: Iterable<K>, checkboxes = false): TableSelection<K> => ({
  all: false,
  ids: new Set(ids),
  checkboxes,
});

export const allTableRows = <K = number>(checkboxes = false): TableSelection<K> => ({
  all: true,
  ids: new Set(),
  checkboxes,
});

export const checkedTableRow = <K>(selection: TableSelection<K>, id: K): boolean =>
  selection.all !== selection.ids.has(id);

/** Both ends of a Shift-click or Shift-arrow range are checked. */
export const tableRange = (anchor: number, focus: number) => ({
  start: Math.min(anchor, focus),
  end: Math.max(anchor, focus),
});

/** Shift-arrows keep their original anchor. An empty table has no range. */
export const extendTableRange = (
  anchor: number | undefined,
  focused: number,
  total: number,
  step: -1 | 1,
) =>
  total === 0
    ? null
    : {
        anchor: anchor ?? focused,
        focus: Math.max(0, Math.min(total - 1, focused + step)),
      };

/** The first toggle starts from the ordinary clicked row, when there is one. */
export const toggleTableRow = <K>(
  selection: TableSelection<K> | undefined,
  id: K,
  clicked?: K,
): TableSelection<K> => {
  const before = selection ?? tableSelectionOf(clicked === undefined ? [] : [clicked]);
  const ids = toggleSelected({ keys: before.ids }, id).keys;
  return { ...before, ids };
};
