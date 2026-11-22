import assert from "node:assert/strict";
import { test } from "node:test";

import { djBatchReadMayResume, djDone, djStartWhileOpen, type DjDone } from "./djDone.ts";

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
  await djDone(dj.set, dj.close).run(() => Promise.resolve("started"));
  assert.deepEqual(dj.states, ["loading"]);
  assert.equal(dj.closed(), 1);
});

test("a batch that comes back empty or fails leaves DJ open with its line", async () => {
  for (const outcome of ["empty", "failed"] as const) {
    const dj = screen();
    await djDone(dj.set, dj.close).run(() => Promise.resolve(outcome));
    assert.deepEqual(dj.states, ["loading", outcome]);
    assert.equal(dj.closed(), 0);
  }
});

test("a start that throws shows the failed line", async () => {
  const dj = screen();
  await djDone(dj.set, dj.close).run(() => Promise.reject(new Error("offline")));
  assert.deepEqual(dj.states, ["loading", "failed"]);
});

test("two quick taps on Done start one queue", async () => {
  const dj = screen();
  const done = djDone(dj.set, dj.close);
  let starts = 0;
  const start = () => {
    starts++;
    return Promise.resolve("started" as const);
  };
  // Both taps land before the screen renders "loading".
  await Promise.all([done.run(start), done.run(start)]);
  assert.equal(starts, 1);
  assert.equal(dj.closed(), 1);
});

test("Done can run again once its start has come back", async () => {
  const dj = screen();
  const done = djDone(dj.set, dj.close);
  let starts = 0;
  const start = () => {
    starts++;
    return Promise.resolve("failed" as const);
  };
  await done.run(start);
  await done.run(start);
  assert.equal(starts, 2);
});

test("a start still loading when DJ closes is cancelled, and never closes DJ again", async () => {
  const dj = screen();
  const done = djDone(dj.set, dj.close);
  let finish: (outcome: "started") => void = () => {};
  let signal: AbortSignal | undefined;
  const running = done.run((given) => {
    signal = given;
    return new Promise((resolve) => (finish = resolve));
  });
  done.cancel();
  assert.equal(signal?.aborted, true);
  finish("started");
  await running;
  assert.equal(dj.closed(), 0);
  assert.deepEqual(dj.states, ["loading"]);
  // A tap after DJ closed starts nothing.
  let starts = 0;
  await done.run(() => {
    starts++;
    return Promise.resolve("started" as const);
  });
  assert.equal(starts, 0);
});

test("a radio answer arriving after Close cannot commit a start or alter the queue", () => {
  const closed = new AbortController();
  const queue = ["the existing song"];
  closed.abort();
  const result = djStartWhileOpen(closed.signal, () => {
    queue.splice(0, queue.length, "the DJ song");
    return "started" as const;
  });
  assert.equal(result, null);
  assert.deepEqual(queue, ["the existing song"]);
  assert.equal(djBatchReadMayResume("closed-start", null), false);
  assert.equal(djBatchReadMayResume("closed-start", "another-session"), false);
  assert.equal(djBatchReadMayResume("started-session", "started-session"), true);
});
