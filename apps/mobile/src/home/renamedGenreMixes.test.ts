import assert from "node:assert/strict";
import { test } from "node:test";

import { forgetRenamedGenreMixes } from "./renamedGenreMixes.ts";

test("the genre mixes kept under the old key are deleted, and the new key's stay", () => {
  const data = new Map([
    ["home.genreMixes", "{}"],
    ["home.genreMixes.shown", "[]"],
    ["home.genreMixes.nothingToBuildFrom", "1"],
    ["home.faithfulGenreMixes", "{}"],
    ["home.discoverMixes", "{}"],
  ]);
  const storage = {
    getItemSync: (key: string) => data.get(key) ?? null,
    removeItemSync: (key: string) => {
      data.delete(key);
    },
  };
  forgetRenamedGenreMixes(storage);
  assert.deepEqual([...data.keys()], ["home.faithfulGenreMixes", "home.discoverMixes"]);
  // Nothing left to delete: a second build changes nothing.
  forgetRenamedGenreMixes(storage);
  assert.equal(data.size, 2);
});
