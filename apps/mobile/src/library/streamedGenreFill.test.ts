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
  await run();
  assert.deepEqual(saved, []);
  fail = false;
  await run();
  assert.deepEqual(saved, [["video", "Jazz"]]);
});

test("a failing video does not block later pages and is retried on a later run", async () => {
  const saved = new Map<string, string | null>();
  const failures: string[] = [];
  for (let run = 0; run < 2; run++)
    await fillStreamedGenres({
      enabled: () => true,
      turn: async () => {},
      page: async (after) =>
        ["a", "b", "c"].filter((id) => id > after && !saved.has(id)).slice(0, 1),
      lookup: async (id) => {
        if (id === "a") throw new Error("bad video");
        return "Rock";
      },
      save: async (id, genre) => {
        saved.set(id, genre);
      },
      failed: (id) => {
        failures.push(id);
      },
    });
  assert.deepEqual([...saved.keys()], ["b", "c"]);
  assert.deepEqual(failures, ["a", "a"]);
});

test("lookups failing in a row, as offline, end the run until the next one", async () => {
  const videos = Array.from({ length: 50 }, (_, i) => `v${String(i).padStart(2, "0")}`);
  let online = false;
  const asks: string[] = [];
  const saved: string[] = [];
  const run = () =>
    fillStreamedGenres({
      enabled: () => true,
      turn: async () => {},
      page: async (after) =>
        videos.filter((id) => id > after && !saved.includes(id)).slice(0, 10),
      lookup: async (id) => {
        asks.push(id);
        if (!online) throw new Error("offline");
        return "Rock";
      },
      save: async (id) => {
        saved.push(id);
      },
    });
  await run();
  assert.deepEqual(asks, ["v00", "v01", "v02"]);
  online = true;
  await run();
  assert.equal(saved.length, 50);
});
