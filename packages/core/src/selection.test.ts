import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  allSelected,
  clearSelection,
  selectAll,
  isSelected,
  NO_SELECTION,
  selectedCount,
  selectedInOrder,
  selectionOf,
  toggleSelected,
  type Selection,
} from "./index.ts";

const same = (key: string) => key;

describe("selection", () => {
  test("toggling a key checks it, toggling it again unchecks it", () => {
    const one = toggleSelected(NO_SELECTION, "b");
    assert.equal(isSelected(one, "b"), true);
    assert.equal(isSelected(one, "a"), false);
    assert.equal(selectedCount(one), 1);

    const two = toggleSelected(one, "a");
    assert.equal(selectedCount(two), 2);

    const back = toggleSelected(two, "b");
    assert.equal(isSelected(back, "b"), false);
    assert.equal(selectedCount(back), 1);
  });

  test("toggling leaves the selection it was given untouched", () => {
    const one = selectionOf(["a"]);
    toggleSelected(one, "b");
    toggleSelected(one, "a");
    assert.equal(selectedCount(one), 1);
    assert.equal(isSelected(one, "a"), true);
  });

  test("clearing unchecks everything", () => {
    assert.equal(selectedCount(clearSelection()), 0);
    assert.equal(selectedCount(NO_SELECTION), 0);
  });

  test("selected items come in the order the list shows them, whatever order they were checked in", () => {
    const list = [
      { id: 1, title: "Airbag" },
      { id: 2, title: "Bloom" },
      { id: 3, title: "Creep" },
      { id: 4, title: "Daydreaming" },
    ];
    let selection: Selection<number> = toggleSelected(NO_SELECTION, 4);
    selection = toggleSelected(selection, 1);
    selection = toggleSelected(selection, 3);
    assert.deepEqual(
      selectedInOrder(selection, list, (song) => song.id).map((song) => song.title),
      ["Airbag", "Creep", "Daydreaming"],
    );
  });

  test("re-sorting the list keeps the same items selected, now in the new order", () => {
    const byTitle = ["a", "b", "c", "d"];
    const reversed = byTitle.toReversed();
    const selection = selectionOf(["b", "d"]);
    assert.deepEqual(
      selectedInOrder(selection, byTitle, (key) => key),
      ["b", "d"],
    );
    assert.deepEqual(
      selectedInOrder(selection, reversed, (key) => key),
      ["d", "b"],
    );
  });

  test("select all checks every item in the list", () => {
    const list = [{ id: 7 }, { id: 3 }, { id: 9 }];
    const all = selectAll(list, (item) => item.id);
    assert.equal(selectedCount(all), 3);
    assert.deepEqual(
      selectedInOrder(all, list, (item) => item.id).map((item) => item.id),
      [7, 3, 9],
    );
  });

  test("everything is selected only once every item in the list is checked", () => {
    const list = ["a", "b", "c"];
    assert.equal(allSelected(selectionOf(["a", "b"]), list, same), false);
    assert.equal(allSelected(selectionOf(["c", "a", "b"]), list, same), true);
    assert.equal(allSelected(selectionOf(["a", "b", "gone"]), list, same), false);
    assert.equal(allSelected(NO_SELECTION, [], same), false);
  });

  test("select all copes with tens of thousands of items", () => {
    const list = Array.from({ length: 50_000 }, (_, index) => index);
    const started = performance.now();
    const all = selectAll(list, (key) => key);
    assert.equal(
      allSelected(all, list, (key) => key),
      true,
    );
    assert.equal(selectedInOrder(toggleSelected(all, 0), list, (key) => key).length, 49_999);
    assert.ok(performance.now() - started < 200);
  });

  test("items no longer in the list drop out", () => {
    assert.deepEqual(
      selectedInOrder(selectionOf(["a", "gone"]), ["a", "b"], (key) => key),
      ["a"],
    );
  });
});
