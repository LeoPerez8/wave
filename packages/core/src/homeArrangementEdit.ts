/**
 * Home's editor away from the stored arrangement: the desktop's window sends
 * each change as a value to the process that keeps the synced setting, which
 * checks it (`readHomeArrangementEdit`) and applies it to what is stored
 * (`editStoredHomeArrangement`).
 */

import {
  DISCOVER_ROWS,
  HOME_SECTIONS,
  editHomeArrangement,
  hiddenDiscoverRows,
  hiddenHomeSections,
  parseHomeArrangement,
  storedHomeArrangement,
  storedHomeSectionId,
  type DiscoverRowEdit,
  type DiscoverRowId,
  type HomeArrangementEdit,
  type HomeSectionId,
} from "./homeSections.ts";
import { isRecord, readStoredRecord } from "./storedJson.ts";

/** No list of sections or rows is anywhere near this long; a position past it isn't one. */
const MOST_PLACES = 100;

const isPlace = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value < MOST_PLACES;

const readMove = (value: unknown): { readonly from: number; readonly to: number } | null =>
  isRecord(value) && isPlace(value.from) && isPlace(value.to)
    ? { from: value.from, to: value.to }
    : null;

const isSection = (value: unknown): value is HomeSectionId =>
  HOME_SECTIONS.some(({ id }) => id === value);

const isRow = (value: unknown): value is DiscoverRowId =>
  DISCOVER_ROWS.some(({ id }) => id === value);

/** One list's edit in `value`, its ids checked by `isId`; null when it holds none. */
const readListEdit = <Id>(
  value: Readonly<Record<string, unknown>>,
  isId: (id: unknown) => id is Id,
):
  | { readonly remove: Id }
  | { readonly add: Id }
  | { readonly move: { readonly from: number; readonly to: number } }
  | null => {
  if ("remove" in value) return isId(value.remove) ? { remove: value.remove } : null;
  if ("add" in value) return isId(value.add) ? { add: value.add } : null;
  const move = readMove(value.move);
  return move === null ? null : { move };
};

/**
 * The edit `value` holds; null when it isn't one: a section or Discover row
 * this Wave doesn't have, or a position that isn't a place in a list.
 */
export const readHomeArrangementEdit = (value: unknown): HomeArrangementEdit | null => {
  if (!isRecord(value)) return null;
  if ("discover" in value) {
    if (!isRecord(value.discover)) return null;
    const discover: DiscoverRowEdit | null = readListEdit(value.discover, isRow);
    return discover === null ? null : { discover };
  }
  return readListEdit(value, isSection);
};

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

/**
 * `edited` with the ids of `stored` that `idOf` doesn't know put back, each
 * after the stored id it followed that `edited` still has, first when none.
 */
const withUnknown = (
  stored: readonly string[],
  edited: readonly string[],
  idOf: (id: string) => string | null,
): string[] => {
  const result = [...edited];
  const before: string[] = [];
  for (const id of stored) {
    const known = idOf(id);
    if (known === null) {
      const anchor = before.findLast((earlier) => result.includes(earlier));
      result.splice(anchor === undefined ? 0 : result.indexOf(anchor) + 1, 0, id);
    }
    before.push(known ?? id);
  }
  return result;
};

const unknownOf = (stored: readonly string[], idOf: (id: string) => string | null): string[] =>
  stored.filter((id) => idOf(id) === null);

const without = (
  record: Readonly<Record<string, unknown>>,
  fields: readonly string[],
): Record<string, unknown> =>
  Object.fromEntries(Object.entries(record).filter(([field]) => !fields.includes(field)));

const rowId = (id: string): string | null => (isRow(id) ? id : null);

/**
 * What to store for Home's arrangement after `edit` to what `stored` holds,
 * by the arrangement rules (`editHomeArrangement`). Sections and Discover
 * rows `stored` names that this Wave doesn't have (a newer Wave's) stay in
 * it, shown ones in their place, so an edit made here never takes them off
 * the Home of the Wave that draws them. With none of those it is what
 * `storedHomeArrangement` gives: null (nothing) for the default.
 */
export const editStoredHomeArrangement = (
  stored: string | null,
  edit: HomeArrangementEdit,
): string | null => {
  const arrangement = editHomeArrangement(parseHomeArrangement(stored), edit);
  const plain = storedHomeArrangement(arrangement);
  const record = readStoredRecord(stored);
  if (!Array.isArray(record.shown)) return plain;
  const discover = isRecord(record.discover) ? record.discover : {};
  const shown = strings(record.shown);
  const hidden = unknownOf(strings(record.hidden), storedHomeSectionId);
  const rows = Array.isArray(discover.shown) ? strings(discover.shown) : [];
  const hiddenRows = unknownOf(strings(discover.hidden), rowId);
  const others = without(record, ["shown", "hidden", "discover"]);
  const otherRowFields = without(discover, ["shown", "hidden"]);
  const nothingUnknown =
    unknownOf(shown, storedHomeSectionId).length === 0 &&
    hidden.length === 0 &&
    unknownOf(rows, rowId).length === 0 &&
    hiddenRows.length === 0 &&
    Object.keys(others).length === 0 &&
    Object.keys(otherRowFields).length === 0;
  if (nothingUnknown) return plain;
  return JSON.stringify({
    ...others,
    shown: withUnknown(shown, arrangement.sections, storedHomeSectionId),
    hidden: [...hiddenHomeSections(arrangement), ...hidden],
    discover: {
      ...otherRowFields,
      shown: withUnknown(rows, arrangement.discoverRows, rowId),
      hidden: [...hiddenDiscoverRows(arrangement), ...hiddenRows],
    },
  });
};
