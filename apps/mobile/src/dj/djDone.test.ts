import assert from "node:assert/strict";
import { test } from "node:test";

import { runDjDone, type DjDone } from "./djDone.ts";

/** Done's states as the screen saw them, and whether DJ closed. */
const screen = () => {
  const states: DjDone[] = [];
  let closed = 0;
  return {
    states,
    closed: () => closed,
    set: (state: DjDone) => void states.push(state),
    close: () => void closed++,
  };
};

test("Done loads while the first batch is read, then closes DJ once the queue plays", async () => {
  const dj = screen();
  await runDjDone("idle", () => Promise.resolve("started"), dj.set, dj.close);
  assert.deepEqual(dj.states, ["loading"]);
  assert.equal(dj.closed(), 1);
});

test("a batch that comes back empty or fails leaves DJ open with its line", async () => {
  for (const outcome of ["empty", "failed"] as const) {
    const dj = screen();
    await runDjDone("idle", () => Promise.resolve(outcome), dj.set, dj.close);
    assert.deepEqual(dj.states, ["loading", outcome]);
    assert.equal(dj.closed(), 0);
  }
});

test("a start that throws shows the failed line", async () => {
  const dj = screen();
  await runDjDone("idle", () => Promise.reject(new Error("offline")), dj.set, dj.close);
  assert.deepEqual(dj.states, ["loading", "failed"]);
});

test("Try Again starts again, and a tap while loading starts nothing", async () => {
  const dj = screen();
  let starts = 0;
  const start = () => {
    starts++;
    return Promise.resolve("started" as const);
  };
  await runDjDone("loading", start, dj.set, dj.close);
  assert.equal(starts, 0);
  await runDjDone("failed", start, dj.set, dj.close);
  assert.equal(starts, 1);
  assert.equal(dj.closed(), 1);
});
