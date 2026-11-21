import assert from "node:assert/strict";
import { test } from "node:test";
import {
  allTableRows,
  checkedTableRow,
  extendTableRange,
  tableRange,
  tableSelectionOf,
  toggleTableRow,
} from "./tableSelection.ts";

test("Ctrl-click adds to the clicked row and can remove either row", () => {
  const two = toggleTableRow(undefined, 12, 7);
  assert.equal(checkedTableRow(two, 7), true);
  assert.equal(checkedTableRow(two, 12), true);
  assert.deepEqual(toggleTableRow(two, 7), tableSelectionOf([12]));
});

test("Select All covers rows the table has never loaded and remembers exclusions", () => {
  const checked = toggleTableRow(allTableRows(), 27);
  assert.equal(checkedTableRow(checked, 27), false);
  assert.equal(checkedTableRow(checked, 50_000), true);
  assert.deepEqual(toggleTableRow(checked, 27), allTableRows());
});

test("Shift-click spans both ends and Shift-arrows can shrink and reverse a range", () => {
  assert.deepEqual(tableRange(650, 150), { start: 150, end: 650 });
  const down = extendTableRange(undefined, 10, 20, 1);
  assert.ok(down);
  assert.deepEqual(down, { anchor: 10, focus: 11 });
  const up = extendTableRange(down.anchor, down.focus, 20, -1);
  assert.ok(up);
  assert.deepEqual(up, { anchor: 10, focus: 10 });
  assert.deepEqual(extendTableRange(up.anchor, up.focus, 20, -1), { anchor: 10, focus: 9 });
  assert.deepEqual(extendTableRange(undefined, 19, 20, 1), { anchor: 19, focus: 19 });
});

test("Shift-arrows have no range in an empty table", () => {
  assert.equal(extendTableRange(undefined, 0, 0, 1), null);
  assert.equal(extendTableRange(3, 5, 0, -1), null);
});
