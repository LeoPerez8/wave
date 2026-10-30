import assert from "node:assert/strict";
import { test } from "node:test";

import { randomMagicQueuePicks } from "./index.ts";

const files = (trackIds: readonly number[]) => ({ trackIds, videoIds: [] });
const entries = (videoIds: readonly string[]) => ({ trackIds: [], videoIds });

test("Home draws nine distinct seeds from the whole Library using the supplied randomness", () => {
  const ids = Object.freeze(Array.from({ length: 30 }, (_, index) => index + 1));
  assert.deepEqual(
    randomMagicQueuePicks(files(ids), () => 0),
    [1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  assert.deepEqual(
    randomMagicQueuePicks(files(ids), () => 0.999),
    [30, 1, 2, 3, 4, 5, 6, 7, 8],
  );
});

test("an empty pool shows nothing and a small one shows every seed", () => {
  assert.deepEqual(
    randomMagicQueuePicks(files([]), () => 0),
    [],
  );
  assert.deepEqual(
    randomMagicQueuePicks(files([4, 5, 6]), () => 0.999),
    [6, 4, 5],
  );
});

test("a song is offered once even when its id occurs twice in the input", () => {
  assert.deepEqual(
    randomMagicQueuePicks(files([1, 1, 2]), () => 0),
    [1, 2],
  );
  assert.deepEqual(
    randomMagicQueuePicks(entries(["a", "a", "b"]), () => 0),
    ["a", "b"],
  );
});

test("the playlists' YT Music entries join the Library's files in one uniform pool", () => {
  const pool = { trackIds: [1, 2, 3], videoIds: ["a", "b", "c", "d", "e", "f", "g", "h"] };
  assert.deepEqual(
    randomMagicQueuePicks(pool, () => 0),
    [1, 2, 3, "a", "b", "c", "d", "e", "f"],
  );
  assert.deepEqual(
    randomMagicQueuePicks(pool, () => 0.999),
    ["h", 1, 2, 3, "a", "b", "c", "d", "e"],
  );
  // A Library id and a video id that read alike are two seeds.
  assert.deepEqual(
    randomMagicQueuePicks({ trackIds: [7], videoIds: ["7"] }, () => 0),
    [7, "7"],
  );
});

test("with no files the row draws from the entries alone", () => {
  assert.deepEqual(
    randomMagicQueuePicks(entries(["x", "y", "z"]), () => 0.999),
    ["z", "x", "y"],
  );
});

test("a live grid keeps surviving seeds in place and fills empty places from the pool", () => {
  const previous = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const available = [1, 2, 3, 5, 6, 7, 8, 9, 10, 11];
  assert.deepEqual(
    randomMagicQueuePicks(files(available), () => 0.999, previous),
    [1, 2, 3, 11, 5, 6, 7, 8, 9],
  );
  assert.deepEqual(
    randomMagicQueuePicks(files([2, 3]), () => 0, previous),
    [2, 3],
  );
  assert.deepEqual(
    randomMagicQueuePicks(files([1, 2, 3]), () => 0, [2, 1]),
    [2, 1, 3],
  );
  // An entry removed from its playlist is replaced in its place; a short row fills up.
  assert.deepEqual(
    randomMagicQueuePicks({ trackIds: [1], videoIds: ["b", "c"] }, () => 0, ["a", 1]),
    ["b", 1, "c"],
  );
});
