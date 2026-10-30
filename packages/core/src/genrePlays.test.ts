import assert from "node:assert/strict";
import { test } from "node:test";
import { genrePlayShares } from "./index.ts";

const totals = (id: number | string, countedPlays: number) => ({
  id,
  countedPlays,
  listenedMs: 0,
  latestPlayAt: 0,
  sortKey: String(id),
});

test("period genres include known streamed songs and exclude unknown genres from shares", () => {
  assert.deepEqual(
    genrePlayShares(
      [totals(1, 2), totals("video", 6), totals("miss", 20), totals("pending", 10)],
      [
        { id: 1, genre: "Rock" },
        { id: "video", genre: "Pop" },
        { id: "miss", genre: null },
      ],
    ).map(({ family, share }) => [family.name, share]),
    [
      ["Pop", 0.75],
      ["Rock", 0.25],
    ],
  );
});
