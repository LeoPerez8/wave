import assert from "node:assert/strict";
import test from "node:test";
import { createHomeFollowReader } from "./homeFollowReader.ts";

test("a post-write refresh sees the write even when a previous visit read is in flight", async () => {
  const before = { follows: [], releases: [], shows: [], country: "BR" };
  const after = { ...before, country: "US" };
  let saved = before;
  let finish!: () => void;
  let first = true;
  const read = createHomeFollowReader(async () => {
    const snapshot = saved;
    if (first) {
      first = false;
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    }
    return snapshot;
  });
  const old = read(before);
  await Promise.resolve();
  saved = after;
  const fresh = read(before);
  finish();
  assert.equal(await old, before);
  assert.equal(await fresh, after);
});

test("a failed read does not block the next refresh", async () => {
  let fail = true;
  const snapshot = { follows: [], releases: [], shows: [], country: "" };
  const read = createHomeFollowReader(async () => {
    if (fail) throw new Error("database unavailable");
    return snapshot;
  });
  await assert.rejects(read(), /database unavailable/);
  fail = false;
  assert.equal(await read(), snapshot);
});
