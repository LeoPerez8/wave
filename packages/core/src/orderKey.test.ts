import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { compareOrderKeys, mergeRows, orderKeyBetween, placeEntries } from "./index.ts";

const longest = (keys: readonly string[]): number => Math.max(...keys.map((key) => key.length));

/** A playlist entry row as two phones sync it. */
const entry = (id: string, orderKey: string, phoneId: string) => ({
  id,
  orderKey,
  phoneId,
  changedAt: 1_000,
  deleted: false,
});

/** The entry ids in the order the playlist lists them. */
const order = (rows: readonly { id: string; orderKey: string }[]): string[] =>
  rows.toSorted(compareOrderKeys).map((row) => row.id);

describe("orderKeyBetween", () => {
  test("a key goes between its neighbours, before the first or after the last", () => {
    const first = orderKeyBetween(null, null);
    const after = orderKeyBetween(first, null);
    const before = orderKeyBetween(null, first);
    const between = orderKeyBetween(first, after);
    assert.ok(before < first);
    assert.ok(first < between);
    assert.ok(between < after);
  });

  test("keys added at the end of a playlist stay short", () => {
    const keys = [orderKeyBetween(null, null)];
    for (let i = 0; i < 2_000; i++) keys.push(orderKeyBetween(keys.at(-1) ?? null, null));
    assert.deepEqual(keys.toSorted(), keys);
    assert.ok(longest(keys) <= 4, `longest key: ${longest(keys)}`);
  });

  test("keys added at the top of a playlist stay short", () => {
    const keys = [orderKeyBetween(null, null)];
    for (let i = 0; i < 2_000; i++) keys.unshift(orderKeyBetween(null, keys[0] ?? null));
    assert.deepEqual(keys.toSorted(), keys);
    assert.ok(longest(keys) <= 4, `longest key: ${longest(keys)}`);
  });

  test("keys added again and again at one place in the middle grow slowly", () => {
    const top = orderKeyBetween(null, null);
    const keys = [top, orderKeyBetween(top, null)];
    for (let i = 0; i < 100; i++) keys.splice(1, 0, orderKeyBetween(top, keys[1] ?? null));
    assert.deepEqual(keys.toSorted(), keys);
    assert.ok(longest(keys) <= 22, `longest key: ${longest(keys)}`);
  });

  test("keys sort as text in the order they were placed, wherever they go", () => {
    let seed = 11;
    const random = (): number => {
      seed = (seed * 48_271) % 2_147_483_647;
      return seed / 2_147_483_647;
    };
    const keys: string[] = [];
    for (let i = 0; i < 1_000; i++) {
      const at = Math.floor(random() * (keys.length + 1));
      keys.splice(at, 0, orderKeyBetween(keys[at - 1] ?? null, keys[at] ?? null));
    }
    assert.deepEqual(keys.toSorted(), keys);
    assert.equal(new Set(keys).size, keys.length);
  });

  test("two phones adding at the same place offline both keep their entries, one after the other", () => {
    const first = orderKeyBetween(null, null);
    const last = orderKeyBetween(first, null);
    const shared = [entry("e-first", first, "pixel"), entry("e-last", last, "pixel")];
    const onPixel = entry("e-pixel", orderKeyBetween(first, last), "pixel");
    const onGalaxy = entry("e-galaxy", orderKeyBetween(first, last), "galaxy");

    const pixelThenGalaxy = mergeRows(mergeRows(shared, [onPixel]).rows, [onGalaxy]).rows;
    const galaxyThenPixel = mergeRows(mergeRows(shared, [onGalaxy]).rows, [onPixel]).rows;
    assert.deepEqual(order(pixelThenGalaxy), ["e-first", "e-galaxy", "e-pixel", "e-last"]);
    assert.deepEqual(order(galaxyThenPixel), order(pixelThenGalaxy));
  });

  test("neighbours out of order, or not order keys, are refused", () => {
    const first = orderKeyBetween(null, null);
    const second = orderKeyBetween(first, null);
    assert.throws(() => orderKeyBetween(second, first), RangeError);
    assert.throws(() => orderKeyBetween(first, first), RangeError);
    assert.throws(() => orderKeyBetween("", null), RangeError);
    assert.throws(() => orderKeyBetween(null, "a00"), RangeError);
  });
});

describe("placeEntries", () => {
  /** A playlist's entries in order, keyed as adding them one after the other at the end keys them. */
  const playlist = (...ids: string[]) => {
    const keyed: { id: string; orderKey: string }[] = [];
    for (const id of ids)
      keyed.push({ id, orderKey: orderKeyBetween(keyed.at(-1)?.orderKey ?? null, null) });
    return keyed;
  };

  /** The playlist after placing new entries [ids] at [index]: its ids in playlist order. */
  const placed = (
    entries: readonly { id: string; orderKey: string }[],
    index: number,
    ids: string[],
  ) => {
    const placement = placeEntries(entries, index, ids.length);
    assert.equal(placement.keys.length, ids.length);
    const rekeyed = new Map(placement.rekeyed.map((row) => [row.id, row.orderKey]));
    return order([
      ...entries.map((row) => ({ ...row, orderKey: rekeyed.get(row.id) ?? row.orderKey })),
      ...ids.map((id, i) => ({ id, orderKey: placement.keys[i] ?? "" })),
    ]);
  };

  test("an empty playlist takes new entries in the order given", () => {
    assert.deepEqual(placed([], 0, ["x", "y", "z"]), ["x", "y", "z"]);
  });

  test("entries go at the end, at the top or between two others, and nothing else moves", () => {
    const entries = playlist("a", "b", "c");
    assert.deepEqual(placed(entries, 3, ["x", "y"]), ["a", "b", "c", "x", "y"]);
    assert.deepEqual(placed(entries, 0, ["x", "y"]), ["x", "y", "a", "b", "c"]);
    assert.deepEqual(placed(entries, 1, ["x", "y"]), ["a", "x", "y", "b", "c"]);
    assert.deepEqual(placeEntries(entries, 1, 2).rekeyed, []);
  });

  test("an index past either end places at that end", () => {
    const entries = playlist("a", "b");
    assert.deepEqual(placed(entries, 9, ["x"]), ["a", "b", "x"]);
    assert.deepEqual(placed(entries, -1, ["x"]), ["x", "a", "b"]);
  });

  test("keys added at the end are the keys adding them one by one makes", () => {
    const entries = playlist("a", "b", "c", "d");
    const { keys } = placeEntries(entries.slice(0, 1), 1, 3);
    assert.deepEqual(
      keys,
      entries.slice(1).map((row) => row.orderKey),
    );
  });

  test("between two entries two phones gave one key, those sharing it are keyed again around the new one", () => {
    const entries = [
      { id: "a", orderKey: "a0" },
      { id: "p", orderKey: "a1" },
      { id: "q", orderKey: "a1" },
      { id: "r", orderKey: "a1" },
      { id: "b", orderKey: "a2" },
    ];
    assert.deepEqual(placed(entries, 2, ["x"]), ["a", "p", "x", "q", "r", "b"]);
    assert.deepEqual(
      placeEntries(entries, 2, 1)
        .rekeyed.map((row) => row.id)
        .toSorted(),
      ["p", "q", "r"],
    );
  });

  test("beside entries that share a key, but not between them, nothing else moves", () => {
    const entries = [
      { id: "p", orderKey: "a1" },
      { id: "q", orderKey: "a1" },
      { id: "b", orderKey: "a2" },
    ];
    assert.deepEqual(placed(entries, 2, ["x"]), ["p", "q", "x", "b"]);
    assert.deepEqual(placeEntries(entries, 2, 1).rekeyed, []);
  });
});
