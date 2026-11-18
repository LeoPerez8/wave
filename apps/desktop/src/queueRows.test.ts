import assert from "node:assert/strict";
import { test } from "node:test";

import type { Page } from "./shared/bridge.ts";
import type { QueueRow } from "./shared/playerView.ts";
import { queueRowAt } from "./renderer/src/queueRows.ts";

const row = (at: number): QueueRow => ({
  id: at + 1,
  title: `Song ${at}`,
  artist: "",
  album: "",
  artworkHash: null,
  durationMs: 1000,
  count: 1,
  year: null,
  genre: null,
  trackNumber: null,
  favorite: false,
  path: null,
  unavailable: false,
  key: `k${at}`,
  at,
  history: false,
  current: at === 0,
});
const page = (offset: number, places: readonly number[]): Page<QueueRow> => ({
  offset,
  total: 6,
  items: places.map(row),
});

test("a queue row is found by its place, past entries whose song is unknown", () => {
  // Entries 1 and 3 have no song: their pages leave them out.
  const pages = new Map([
    [0, page(0, [0, 2])],
    [1, page(3, [4, 5])],
  ]);
  const keys = [0, 1, 2, 3, 4, 5, 6].map((at) => queueRowAt(pages, 3, at)?.key);
  assert.deepEqual(keys, ["k0", undefined, "k2", undefined, "k4", "k5", undefined]);
  assert.equal(queueRowAt(new Map(), 3, 0), undefined, "a page not loaded yet");
});
