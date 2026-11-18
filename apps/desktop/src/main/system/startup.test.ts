import assert from "node:assert/strict";
import { test } from "node:test";
import { followStart } from "./startup.ts";

const deferred = () => {
  let resolve = () => {};
  let reject = (_error: unknown) => {};
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

/** A start whose page and services the test settles, with a wait it ends by hand. */
const start = () => {
  const painted = deferred();
  const services = deferred();
  const steps: string[] = [];
  const timers = new Set<() => void>();
  followStart({
    painted: painted.promise,
    services: services.promise,
    started: () => steps.push("started"),
    reveal: () => steps.push("reveal"),
    failed: (error) => steps.push(`failed: ${String(error)}`),
    waitMs: 5_000,
    after: (_ms, run) => {
      timers.add(run);
      return () => void timers.delete(run);
    },
  });
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  return {
    painted,
    services,
    steps,
    settle,
    /** The wait runs out, if one is still on. */
    waitEnds: () => {
      const due = Array.from(timers);
      timers.clear();
      for (const run of due) run();
    },
    waiting: () => timers.size,
  };
};

test("the window is revealed once its page is painted and the services are up", async () => {
  const wave = start();
  wave.services.resolve();
  await wave.settle();
  assert.deepEqual(wave.steps, ["started"], "not before the page is painted");
  wave.painted.resolve();
  await wave.settle();
  assert.deepEqual(wave.steps, ["started", "reveal"]);
  assert.equal(wave.waiting(), 0);
});

test("services that take too long don't keep the window hidden", async () => {
  const wave = start();
  wave.painted.resolve();
  await wave.settle();
  assert.deepEqual(wave.steps, []);
  wave.waitEnds();
  assert.deepEqual(wave.steps, ["reveal"]);
  // They come up later: the theme is applied, the window isn't revealed twice.
  wave.services.resolve();
  await wave.settle();
  assert.deepEqual(wave.steps, ["reveal", "started"]);
});

test("the wait starts with the page, and ends when the services are up", async () => {
  const wave = start();
  await wave.settle();
  assert.equal(wave.waiting(), 0, "nothing to reveal before the page is painted");
  wave.painted.resolve();
  await wave.settle();
  assert.equal(wave.waiting(), 1);
  wave.services.resolve();
  await wave.settle();
  assert.deepEqual(wave.steps, ["started", "reveal"]);
  assert.equal(wave.waiting(), 0);
});

test("services that fail are reported once, and the window isn't revealed", async () => {
  const wave = start();
  wave.services.reject(new Error("no database"));
  await wave.settle();
  wave.painted.resolve();
  await wave.settle();
  wave.waitEnds();
  assert.deepEqual(wave.steps, ["failed: Error: no database"]);
  assert.equal(wave.waiting(), 0);
});

test("services that fail after the window was revealed are still reported", async () => {
  const wave = start();
  wave.painted.resolve();
  await wave.settle();
  wave.waitEnds();
  wave.services.reject(new Error("no audio"));
  await wave.settle();
  assert.deepEqual(wave.steps, ["reveal", "failed: Error: no audio"]);
});
