import assert from "node:assert/strict";
import { test } from "node:test";

import { albumDiscHeads } from "./index.ts";

test("a two-disc album has a head before each disc's first track", () => {
  assert.deepEqual(albumDiscHeads([1, 1, 1, 2, 2]), [
    { disc: 1, at: 0 },
    { disc: 2, at: 3 },
  ]);
});

test("a one-disc album has no heads, tagged or not", () => {
  assert.deepEqual(albumDiscHeads([1, 1, 1]), []);
  assert.deepEqual(albumDiscHeads([null, null]), []);
  assert.deepEqual(albumDiscHeads([null, 1]), []);
  assert.deepEqual(albumDiscHeads([]), []);
});

test("a track with no disc tag is on disc 1", () => {
  assert.deepEqual(albumDiscHeads([null, 2]), [
    { disc: 1, at: 0 },
    { disc: 2, at: 1 },
  ]);
});

test("a streamed song neither leads a disc nor ends one", () => {
  // The release's songs the Library lacks sit among its tracks: undefined, no disc of their own.
  assert.deepEqual(albumDiscHeads([undefined, 1, undefined, 1, 2, undefined]), [
    { disc: 1, at: 1 },
    { disc: 2, at: 4 },
  ]);
  assert.deepEqual(albumDiscHeads([1, undefined, 1]), []);
});
