import assert from "node:assert/strict";
import { test } from "node:test";
import { fillStreamedGenres } from "./streamedGenreFill.ts";

test("off sends nothing; sequential fill saves answers and misses, checking consent before each ask", async () => {
  let enabled = false;
  const saved: unknown[] = [];
  const asks: string[] = [];
  const run = () =>
    fillStreamedGenres({
      enabled: () => enabled,
      turn: async () => {},
      page: async (after) => ["a", "b", "c"].filter((id) => id > after),
      lookup: async (id) => {
        asks.push(id);
        if (id === "b") enabled = false;
        return id === "a" ? "Rock" : null;
      },
      save: async (id, genre) => {
        saved.push([id, genre]);
      },
    });
  await run();
  assert.deepEqual(asks, []);
  enabled = true;
  await run();
  assert.deepEqual(asks, ["a", "b"]);
  assert.deepEqual(saved, [
    ["a", "Rock"],
    ["b", null],
  ]);
});

test("a failed lookup saves no miss and the next run retries it", async () => {
  let fail = true;
  const saved: unknown[] = [];
  const run = () =>
    fillStreamedGenres({
      enabled: () => true,
      turn: async () => {},
      page: async (after) => (after === "" ? ["video"] : []),
      lookup: async () => {
        if (fail) throw new Error("offline");
        return "Jazz";
      },
      save: async (id, genre) => {
        saved.push([id, genre]);
      },
    });
  await assert.rejects(run(), /offline/);
  assert.deepEqual(saved, []);
  fail = false;
  await run();
  assert.deepEqual(saved, [["video", "Jazz"]]);
});
