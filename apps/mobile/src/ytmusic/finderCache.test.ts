/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { makeFinderCache } from "./finderCache.ts";

/** Reads the test settles by hand. */
const manualReads = () => {
  const pending: { settle: (rows: readonly string[] | Error) => void }[] = [];
  const read = () =>
    new Promise<readonly string[]>((resolve, reject) => {
      pending.push({ settle: (rows) => (rows instanceof Error ? reject(rows) : resolve(rows)) });
    });
  return { pending, read };
};

/** A finder that says which rows it was built over. */
const build = (rows: readonly string[]) => () => rows.join(",");

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe("one Library finder shared by every screen", () => {
  test("the same rows give the same finder, built once", () => {
    let builds = 0;
    const { read } = manualReads();
    const cache = makeFinderCache({
      version: () => 1,
      read,
      build: (rows: readonly string[]) => (builds++, build(rows)),
    });
    const rows = ["a", "b"];
    const first = cache.over(rows);
    assert.equal(cache.over(rows), first);
    assert.equal(builds, 1);
    assert.equal(first(), "a,b");
  });

  test("knows the last finder made, or nothing before the first", () => {
    const { read } = manualReads();
    const cache = makeFinderCache({ version: () => 1, read, build });
    assert.equal(cache.known(), null);
    const finder = cache.over(["a"]);
    assert.equal(cache.known(), finder);
  });

  test("a current finder reads the Library once per version, and shares a read under way", async () => {
    let version = 1;
    const { pending, read } = manualReads();
    const cache = makeFinderCache({ version: () => version, read, build });

    const one = cache.current();
    const two = cache.current();
    assert.equal(pending.length, 1);
    pending[0]?.settle(["a"]);
    assert.equal((await one)(), "a");
    assert.equal((await two)(), "a");
    assert.equal(cache.known()?.(), "a");

    assert.equal((await cache.current())(), "a");
    assert.equal(pending.length, 1);

    version = 2;
    const three = cache.current();
    assert.equal(pending.length, 2);
    pending[1]?.settle(["a", "b"]);
    assert.equal((await three)(), "a,b");
  });

  test("rows a screen showed don't count as current: they may be from before a change", async () => {
    const { pending, read } = manualReads();
    const cache = makeFinderCache({ version: () => 1, read, build });
    cache.over(["old"]);
    const current = cache.current();
    assert.equal(pending.length, 1);
    pending[0]?.settle(["new"]);
    assert.equal((await current)(), "new");
  });

  test("a failed read fails the wait and is tried again next time", async () => {
    const { pending, read } = manualReads();
    const cache = makeFinderCache({ version: () => 1, read, build });
    const failed = cache.current();
    pending[0]?.settle(new Error("no Library"));
    await assert.rejects(failed);
    await tick();
    const again = cache.current();
    assert.equal(pending.length, 2);
    pending[1]?.settle(["a"]);
    assert.equal((await again)(), "a");
  });
});

test("alternating full and artist rows reuse their finder without replacing the known Library", () => {
  let builds = 0;
  const cache = makeFinderCache({
    version: () => 1,
    read: async () => [],
    build: (rows: readonly string[]) => {
      builds++;
      return build(rows);
    },
  });
  const rows = ["full"];
  const artist = ["artist"];
  const full = cache.over(rows);
  const own = cache.forRows(artist);
  assert.equal(cache.over(rows), full);
  assert.equal(cache.forRows(artist), own);
  assert.equal(cache.known(), full);
  assert.equal(builds, 2);
});
