import assert from "node:assert/strict";
import { test } from "node:test";

import { createWarmPanes, WARM_AFTER_CLOSE_MS } from "./warmPanes.ts";

const harness = () => {
  const timers: { run: () => void; ms: number; cancelled: boolean }[] = [];
  let memory: (() => void) | undefined;
  const changes: boolean[] = [];
  const panes = createWarmPanes({
    changed: (warm) => changes.push(warm),
    schedule: (run, ms) => {
      const timer = { run, ms, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    onMemoryWarning: (listener) => {
      memory = listener;
      return () => {
        memory = undefined;
      };
    },
  });
  const elapse = () => {
    for (const timer of timers.splice(0)) if (!timer.cancelled) timer.run();
  };
  return { panes, changes, timers, elapse, warnMemory: () => memory?.() };
};

test("the panes warm only once the sheet has settled open", () => {
  const { panes, changes } = harness();
  panes.send({ type: "shown" });
  assert.equal(panes.warm(), false);
  panes.send({ type: "settled" });
  assert.equal(panes.warm(), true);
  assert.deepEqual(changes, [true]);
});

test("closed, the panes unmount a few seconds later", () => {
  const { panes, timers, elapse } = harness();
  panes.send({ type: "settled" });
  panes.send({ type: "hidden" });
  assert.equal(panes.warm(), true);
  assert.equal(timers[0]?.ms, WARM_AFTER_CLOSE_MS);
  elapse();
  assert.equal(panes.warm(), false);
});

test("reopened before the wait ends, the panes stay warm", () => {
  const { panes, elapse } = harness();
  panes.send({ type: "settled" });
  panes.send({ type: "hidden" });
  panes.send({ type: "shown" });
  elapse();
  assert.equal(panes.warm(), true);
});

test("the next settled open warms them again", () => {
  const { panes, elapse, changes } = harness();
  panes.send({ type: "settled" });
  panes.send({ type: "hidden" });
  elapse();
  panes.send({ type: "shown" });
  assert.equal(panes.warm(), false);
  panes.send({ type: "settled" });
  assert.equal(panes.warm(), true);
  assert.deepEqual(changes, [true, false, true]);
});

test("a memory warning with the sheet closed unmounts them at once", () => {
  const { panes, warnMemory, timers } = harness();
  panes.send({ type: "settled" });
  panes.send({ type: "hidden" });
  warnMemory();
  assert.equal(panes.warm(), false);
  assert.equal(timers[0]?.cancelled, true);
});

test("a memory warning with the sheet open keeps them, ready for the swipe", () => {
  const { panes, warnMemory } = harness();
  panes.send({ type: "settled" });
  warnMemory();
  assert.equal(panes.warm(), true);
});
