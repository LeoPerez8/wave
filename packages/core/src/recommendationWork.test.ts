import assert from "node:assert/strict";
import { test } from "node:test";
import { recommendationDeadline, recommendationFrameBudget } from "./index.ts";

test("recommendation pages run back to back until the display needs its frame", () => {
  let now = 0;
  const budget = recommendationFrameBudget({ now: () => now, intervalMs: () => 1000 / 120 });
  assert.equal(budget.due(), false);
  now = 4;
  assert.equal(budget.due(), false, "a four-ms ranking slice needs no separate turn");
  now = 6.5;
  assert.equal(budget.due(), true, "leave two ms for the frame's other work");
  now = 8.5;
  budget.yielded();
  assert.equal(budget.due(), false);
  now = 12;
  assert.equal(budget.due(), false, "the next page shares the new frame budget");
});

test("someone waiting for offers gets a longer run before the frame, at every refresh rate", () => {
  for (const [rate, runMs] of [
    [120, 12],
    [90, 12],
    [60, 1000 / 60 - 4],
    [30, 1000 / 30 - 4],
  ] as const) {
    let now = 0;
    const budget = recommendationFrameBudget({ now: () => now, intervalMs: () => 1000 / rate });
    now = runMs - 0.01;
    assert.equal(budget.dueAwaited(), false, `${rate} Hz, before ${runMs} ms`);
    now = runMs;
    assert.equal(budget.dueAwaited(), true, `${rate} Hz, at ${runMs} ms`);
    budget.yielded();
    assert.equal(budget.dueAwaited(), false, "the next run starts with its frame");
  }
});

test("a recommendation deadline includes time spent suspended and expires at its boundary", () => {
  let now = 1000;
  const deadline = recommendationDeadline(60_000, () => now);
  now = 60_999;
  assert.equal(deadline.remainingMs(), 1);
  assert.equal(deadline.expired(), false);
  now = 61_000;
  assert.equal(deadline.expired(), true);
  now = 893_000;
  assert.equal(deadline.remainingMs(), 0);
  assert.equal(deadline.expired(), true, "no timer ticks are needed while the app is suspended");
});

test("recommendation work follows display changes and uses a safe cadence when unmeasured", () => {
  let now = 0;
  let interval = 1000 / 60;
  const budget = recommendationFrameBudget({ now: () => now, intervalMs: () => interval });
  now = 7;
  assert.equal(budget.due(), false);
  interval = 1000 / 120;
  assert.equal(budget.due(), true);
  budget.yielded();
  interval = 0;
  now = 14;
  assert.equal(budget.due(), true, "unknown cadence protects a 120 Hz display");
  budget.yielded();
  interval = NaN;
  now = 21;
  assert.equal(budget.due(), true);
});
