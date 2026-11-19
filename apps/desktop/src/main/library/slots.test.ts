import assert from "node:assert/strict";
import { test } from "node:test";
import { slots } from "./slots.ts";

test("a task that arrives just as another ends still waits for a free slot", async () => {
  const run = slots(2);
  let running = 0;
  let most = 0;
  const ends: (() => void)[] = [];
  const task = () =>
    run(async () => {
      most = Math.max(most, ++running);
      await new Promise<void>((resolve) => ends.push(resolve));
      running--;
    });
  const first = task();
  const rest = [task(), task()];
  // What ends the first task also brings a fourth, in the turn right after its slot is given up.
  const end = ends.shift()!;
  const ended = Promise.resolve().then(end);
  rest.push(
    ended.then(() => new Promise<void>((resolve) => queueMicrotask(() => resolve(task())))),
  );
  await first;
  while (running > 0) {
    await new Promise((resolve) => setImmediate(resolve));
    ends.shift()?.();
  }
  await Promise.all(rest);
  assert.equal(most, 2);
});

test("waiting tasks run in the order they came, and a failed task frees its slot", async () => {
  const run = slots(1);
  const order: number[] = [];
  const failed = run(async () => {
    throw new Error("no");
  });
  const rest = [1, 2, 3].map((n) => run(async () => void order.push(n)));
  await assert.rejects(failed, /no/);
  await Promise.all(rest);
  assert.deepEqual(order, [1, 2, 3]);
});
