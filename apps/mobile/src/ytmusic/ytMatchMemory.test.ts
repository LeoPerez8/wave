import assert from "node:assert/strict";
import { test } from "node:test";
import { ytMatchMemory } from "./ytMatchMemory.ts";

const phone = () => {
  const data = new Map<string, string>();
  return {
    data,
    multiGet: (keys: string[]) =>
      Promise.resolve(keys.map((key) => [key, data.get(key) ?? null] as const)),
    setItem: (key: string, value: string) => {
      data.set(key, value);
      return Promise.resolve();
    },
  };
};

test("recalls the matches remembered for Library songs, by track id", async () => {
  const storage = phone();
  const memory = ytMatchMemory(storage);
  await memory.remember(7, "yt-lucky");
  await memory.remember(9, "yt-other");
  assert.deepEqual(
    [...(await memory.recall([7, 8, 9]))],
    [
      [7, "yt-lucky"],
      [9, "yt-other"],
    ],
  );
  assert.deepEqual([...storage.data.keys()], ["ytMatch.7", "ytMatch.9"]);
});

test("asks the store nothing for no songs", async () => {
  const memory = ytMatchMemory({
    multiGet: () => Promise.reject(new Error("asked")),
    setItem: () => Promise.resolve(),
  });
  assert.equal((await memory.recall([])).size, 0);
});
