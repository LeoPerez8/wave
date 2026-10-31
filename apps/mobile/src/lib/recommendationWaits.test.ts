import assert from "node:assert/strict";
import { test } from "node:test";
import * as Effect from "effect/Effect";
import { createRecommendationWork } from "./recommendationTurn.ts";

/** A clock each step moves on, 120 Hz frames run by hand. */
const paced = (stepMs: number) => {
  const host = { now: 0, intervalMs: 1000 / 120 };
  const frames = new Set<() => void>();
  const work = createRecommendationWork({
    now: () => host.now,
    intervalMs: () => host.intervalMs,
    request: (run) => {
      frames.add(run);
      return () => {
        frames.delete(run);
      };
    },
  });
  const steps = function* (count: number, each?: () => void) {
    for (let step = 0; step < count; step++) {
      host.now += stepMs;
      each?.();
      yield;
    }
    return "ranked";
  };
  const settled = () => new Promise<void>((resolve) => setImmediate(resolve));
  /** The next vsync after the clock, then what it woke. */
  const frame = async () => {
    host.now = (Math.floor(host.now / (1000 / 120)) + 1) * (1000 / 120);
    const due = [...frames];
    for (const run of due) run();
    await settled();
  };
  return { host, frames, work, steps, frame, settled };
};

const stepsInASecondFrame = async (awaited: boolean) => {
  const { work, steps, frame, settled } = paced(0.001);
  let done = 0;
  const result = Effect.runPromise(
    work.steps(
      steps(40_000, () => done++),
      () => awaited,
    ),
  );
  await settled();
  await frame();
  const first = done;
  await frame();
  const second = done - first;
  while (done < 40_000) await frame();
  assert.equal(await result, "ranked");
  return second;
};

test("a ranking someone waits for runs 12 ms per frame, past 512 steps a slice", async () => {
  const steps = await stepsInASecondFrame(true);
  assert.ok(steps >= 11_900 && steps <= 12_100, `${steps} steps of 1 us`);
});

test("a ranking no one waits for keeps today's budget", async () => {
  const steps = await stepsInASecondFrame(false);
  // Slices of 512 steps until 6.33 ms of the frame have gone.
  assert.ok(steps >= 6_300 && steps <= 6_900, `${steps} steps of 1 us`);
});

test("the same steps give the same answer whoever waits", async () => {
  const sum = function* () {
    let total = 0;
    for (let step = 1; step <= 2000; step++) {
      total = (total * 31 + step) % 1_000_003;
      yield;
    }
    return total;
  };
  let plain: number | undefined;
  const whole = sum();
  for (let next = whole.next(); ; next = whole.next())
    if (next.done === true) {
      plain = next.value;
      break;
    }
  for (const awaited of [true, false]) {
    const { work, frame, settled } = paced(0);
    const result = Effect.runPromise(work.steps(sum(), () => awaited));
    await settled();
    await frame();
    assert.equal(await result, plain);
  }
});

test("background turns pause while a ranking is awaited and carry on once it ends", async () => {
  const { work, steps, frame, settled } = paced(0.01);
  const ranking = Effect.runPromise(work.steps(steps(40_000), () => true));
  await settled();
  await frame();
  let background = false;
  void Effect.runPromise(work.turn).then(() => {
    background = true;
  });
  await frame();
  await frame();
  assert.equal(background, false, "frames came and the background is still paused");
  while (!background) await frame();
  assert.equal(await ranking, "ranked");
});

test("a ranking no one waits for leaves background turns running, until someone does", async () => {
  const { host, work, steps, frame, settled } = paced(0.01);
  let awaited = false;
  const ranking = Effect.runPromise(work.steps(steps(60_000), () => awaited));
  await settled();
  await frame();
  /** With the budget out of the way, whether a background turn goes on or is paused. */
  const backgroundGoesOn = async () => {
    host.intervalMs = 1e9;
    let went = false;
    const abort = new AbortController();
    const asked = Effect.runPromise(work.turn, { signal: abort.signal }).then(
      () => {
        went = true;
      },
      () => {},
    );
    await settled();
    host.intervalMs = 1000 / 120;
    abort.abort();
    await asked;
    return went;
  };
  assert.equal(await backgroundGoesOn(), true);
  awaited = true;
  await frame();
  assert.equal(await backgroundGoesOn(), false, "the wait began: the background pauses");
  awaited = false;
  await frame();
  assert.equal(await backgroundGoesOn(), true, "no one waits any more: it carries on");
  for (let i = 0; i < 400; i++) await frame();
  assert.equal(await ranking, "ranked");
});

test("cancelling an awaited ranking closes its steps and lets the background go", async () => {
  const { work, frames, frame, settled, host } = paced(0);
  let closed = false;
  const endless = (function* () {
    try {
      for (;;) {
        host.now += 1;
        yield;
      }
    } finally {
      closed = true;
    }
  })();
  const abort = new AbortController();
  const ranking = Effect.runPromise(
    work.steps(endless, () => true),
    { signal: abort.signal },
  );
  const stopped = assert.rejects(ranking);
  await settled();
  await frame();
  let background = false;
  void Effect.runPromise(work.turn).then(() => {
    background = true;
  });
  await settled();
  assert.equal(background, false);
  abort.abort();
  await stopped;
  assert.equal(closed, true);
  await settled();
  while (!background) await frame();
  assert.equal(frames.size, 0);
});

test("a background turn cancelled while paused isn't woken", async () => {
  const { work, steps, frame, settled } = paced(0.01);
  const ranking = Effect.runPromise(work.steps(steps(2000), () => true));
  await settled();
  await frame();
  const abort = new AbortController();
  const paused = Effect.runPromise(work.turn, { signal: abort.signal });
  const stopped = assert.rejects(paused);
  await settled();
  abort.abort();
  await stopped;
  for (let i = 0; i < 40; i++) await frame();
  assert.equal(await ranking, "ranked");
});
