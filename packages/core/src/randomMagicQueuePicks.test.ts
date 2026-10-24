import assert from "node:assert/strict";
import { test } from "node:test";

import { randomMagicQueuePicks } from "./index.ts";

test("Home draws nine distinct seeds from the whole Library using the supplied randomness", () => {
  const ids = Object.freeze(Array.from({ length: 30 }, (_, index) => index + 1));
  assert.deepEqual(
    randomMagicQueuePicks(ids, () => 0),
    [1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  assert.deepEqual(
    randomMagicQueuePicks(ids, () => 0.999),
    [30, 1, 2, 3, 4, 5, 6, 7, 8],
  );
});

test("an empty Library shows nothing and a small Library shows every song", () => {
  assert.deepEqual(
    randomMagicQueuePicks([], () => 0),
    [],
  );
  assert.deepEqual(
    randomMagicQueuePicks(["never-played", "favorite", "skipped"], () => 0.999),
    ["skipped", "never-played", "favorite"],
  );
});

test("a song is offered once even when its id occurs twice in the input", () => {
  assert.deepEqual(
    randomMagicQueuePicks([1, 1, 2], () => 0),
    [1, 2],
  );
});

test("a live grid keeps surviving seeds in place and fills empty places with random files", () => {
  const previous = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const available = [1, 2, 3, 5, 6, 7, 8, 9, 10, 11];
  assert.deepEqual(
    randomMagicQueuePicks(available, () => 0.999, previous),
    [1, 2, 3, 11, 5, 6, 7, 8, 9],
  );
  assert.deepEqual(
    randomMagicQueuePicks([2, 3], () => 0, previous),
    [2, 3],
  );
  assert.deepEqual(
    randomMagicQueuePicks([1, 2, 3], () => 0, [2, 1]),
    [2, 1, 3],
  );
});
