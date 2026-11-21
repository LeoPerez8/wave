import assert from "node:assert/strict";
import { test } from "node:test";

import { startKeptTotalsSettler } from "./keptTotalsSettler.ts";

/** A settler over fakes: [owed] steps until settled, turns the test hands out one by one. */
const harness = (owed: number) => {
  const log: string[] = [];
  let left = owed;
  const turns: (() => void)[] = [];
  let changed: (() => void) | undefined;
  const stop = startKeptTotalsSettler({
    turn: () =>
      new Promise((resolve) => {
        log.push("turn");
        turns.push(resolve);
      }),
    step: async () => {
      log.push("step");
      left = Math.max(0, left - 1);
      return left === 0;
    },
    onChange: (listener) => {
      changed = listener;
      return () => (changed = undefined);
    },
    failed: (cause) => log.push(`failed ${String(cause)}`),
  });
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  return {
    log,
    stop,
    owe: (steps: number) => {
      left += steps;
      changed?.();
    },
    /** Hands out the next turn and lets the step it waited for run. */
    nextTurn: async () => {
      turns.shift()?.();
      await flush();
    },
    flush,
    waiting: () => turns.length,
  };
};

test("settles one step per turn until nothing is owed, then waits", async () => {
  const settler = harness(3);
  await settler.flush();
  for (let turn = 0; turn < 3; turn++) await settler.nextTurn();
  assert.deepEqual(settler.log, ["turn", "step", "turn", "step", "turn", "step"]);
  assert.equal(settler.waiting(), 0);
});

test("a Library change starts it again", async () => {
  const settler = harness(1);
  await settler.flush();
  await settler.nextTurn();
  settler.owe(2);
  await settler.flush();
  await settler.nextTurn();
  await settler.nextTurn();
  assert.deepEqual(settler.log, ["turn", "step", "turn", "step", "turn", "step"]);
  assert.equal(settler.waiting(), 0);
});

test("a change while it runs adds no second loop", async () => {
  const settler = harness(2);
  await settler.flush();
  settler.owe(0);
  settler.owe(0);
  await settler.nextTurn();
  await settler.nextTurn();
  assert.deepEqual(settler.log, ["turn", "step", "turn", "step"]);
});

test("stopped, it takes no further step", async () => {
  const settler = harness(5);
  await settler.flush();
  await settler.nextTurn();
  settler.stop();
  await settler.nextTurn();
  settler.owe(1);
  await settler.flush();
  assert.deepEqual(settler.log, ["turn", "step", "turn"]);
});
