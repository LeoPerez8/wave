import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { compareOrderKeys, mergeRows, orderKeyBetween } from "./index.ts";

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
