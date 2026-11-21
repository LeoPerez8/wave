import assert from "node:assert/strict";
import { test } from "node:test";

import { createRecentKeeps } from "./index.ts";

const setup = (max: number) => {
  const held = new Set<string>();
  const keeps = createRecentKeeps<string>({
    max,
    keep: (key) => {
      held.add(key);
      return () => held.delete(key);
    },
  });
  return { keeps, held };
};

test("the screens opened last stay kept, at most max of them, the least recent let go first", () => {
  const { keeps, held } = setup(2);
  keeps.touch("playlist:1");
  keeps.touch("playlist:2");
  keeps.touch("playlist:1");
  keeps.touch("playlist:3");
  assert.deepEqual([...held].sort(), ["playlist:1", "playlist:3"]);
});

test("touching a kept key again keeps it once", () => {
  const { keeps, held } = setup(3);
  keeps.touch("genre:1");
  keeps.touch("genre:1");
  assert.equal(keeps.size(), 1);
  assert.deepEqual([...held], ["genre:1"]);
});

test("clear lets every key go", () => {
  const { keeps, held } = setup(3);
  keeps.touch("a");
  keeps.touch("b");
  keeps.clear();
  assert.equal(held.size, 0);
  assert.equal(keeps.size(), 0);
});
