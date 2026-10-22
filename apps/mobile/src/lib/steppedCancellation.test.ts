import assert from "node:assert/strict";
import test from "node:test";
import * as Effect from "effect/Effect";
import { runSteps } from "./stepped.ts";

test("CPU work yields with scheduler headroom and interruption releases its iterator and pending turn", async () => {
  let time = 0;
  let items = 0;
  let released = false;
  let cancelled = 0;
  const pending: (() => void)[] = [];
  const turn = Effect.callback<void>((resume) => {
    const run = () => resume(Effect.void);
    pending.push(run);
    return Effect.sync(() => {
      const i = pending.indexOf(run);
      if (i >= 0) {
        pending.splice(i, 1);
        cancelled++;
      }
    });
  });
  function* job() {
    try {
      while (items < 100) {
        items++;
        time++;
        yield;
      }
      return "done";
    } finally {
      released = true;
    }
  }
  const controller = new AbortController();
  const result = Effect.runPromise(
    runSteps(job(), turn, () => time),
    { signal: controller.signal },
  );
  assert.equal(items, 0);
  pending.shift()!();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(items, 4);
  assert.equal(pending.length, 1);
  controller.abort();
  await assert.rejects(result);
  assert.equal(cancelled, 1);
  assert.equal(released, true);
  assert.equal(pending.length, 0);
  assert.equal(items, 4);
});
