import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import * as Effect from "effect/Effect";
import { runTestPromise } from "../lib/steppedTesting.ts";
import type { ScreenSight } from "@wave/client/sight";

import { pacedSteps } from "../lib/stepped.ts";
import { createHomeWork } from "./homeWork.ts";

/** A screen's sight the test moves in and out. */
const sightOf = (visible: boolean) => {
  const listeners = new Set<(visible: boolean) => void>();
  const sight: ScreenSight = {
    visible: () => visible,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    sight,
    set: (next: boolean) => {
      visible = next;
      for (const listener of listeners) listener(next);
    },
  };
};

/** Steps that count themselves, one slice each. */
const counted = function* (count: { steps: number }, total: number) {
  for (let i = 0; i < total; i++) {
    count.steps++;
    yield;
  }
  return "done";
};

test("Home's work takes its turns while Home is in sight", async () => {
  const work = createHomeWork();
  const home = sightOf(true);
  work.follow(home.sight);
  assert.equal(await runTestPromise(Effect.as(work.turn, "ran")), "ran");
});

test("nothing runs before Home is first shown", async () => {
  const work = createHomeWork();
  let ran = false;
  void runTestPromise(work.turn).then(() => (ran = true));
  await setImmediate();
  assert.equal(ran, false);
  const home = sightOf(true);
  work.follow(home.sight);
  await setImmediate();
  assert.equal(ran, true);
});

test("leaving Home stops a build after the slice that was running; coming back resumes it", async () => {
  const work = createHomeWork();
  const home = sightOf(true);
  work.follow(home.sight);
  const count = { steps: 0 };
  const between = Effect.andThen(
    work.turn,
    Effect.promise(() => setImmediate()),
  );
  const built = runTestPromise(
    Effect.suspend(() => runStepsOneAtATime(counted(count, 20), between)),
  );
  while (count.steps < 3) await setImmediate();
  // Settings is pushed over Home.
  home.set(false);
  const stoppedAt = count.steps;
  for (let i = 0; i < 20; i++) await setImmediate();
  assert.ok(count.steps <= stoppedAt + 1, `${count.steps - stoppedAt} steps ran off Home`);
  const offHome = count.steps;
  home.set(true);
  assert.equal(await built, "done");
  assert.equal(count.steps, 20);
  assert.ok(offHome < 20);
});

test("someone off Home waiting for the work lets it run while they wait", async () => {
  const work = createHomeWork();
  const home = sightOf(false);
  work.follow(home.sight);
  const count = { steps: 0 };
  const between = Effect.andThen(
    work.turn,
    Effect.promise(() => setImmediate()),
  );
  // A Magic Queue started from Search waits for the snapshot Home's build reads.
  const result = await runTestPromise(
    work.wanted(Effect.suspend(() => runStepsOneAtATime(counted(count, 5), between))),
  );
  assert.equal(result, "done");
  assert.equal(count.steps, 5);
  // Once nobody waits, Home's gate closes again.
  let ran = false;
  void runTestPromise(work.turn).then(() => (ran = true));
  await setImmediate();
  assert.equal(ran, false);
});

test("a Home screen that unmounts stops holding the gate open", async () => {
  const work = createHomeWork();
  const home = sightOf(true);
  const stop = work.follow(home.sight);
  stop();
  let ran = false;
  void runTestPromise(work.turn).then(() => (ran = true));
  await setImmediate();
  assert.equal(ran, false);
});

test("Home's work waits until Home's first content has been drawn (#1487)", async () => {
  const work = createHomeWork();
  const drawn = work.waitForContent();
  const home = sightOf(true);
  work.follow(home.sight);
  let ran = false;
  void runTestPromise(work.turn).then(() => (ran = true));
  await setImmediate();
  assert.equal(ran, false);
  drawn();
  await setImmediate();
  assert.equal(ran, true);
});

test("someone off Home waiting for the work doesn't wait for Home's content", async () => {
  const work = createHomeWork();
  work.waitForContent();
  work.follow(sightOf(true).sight);
  assert.equal(await runTestPromise(work.wanted(Effect.as(work.turn, "ran"))), "ran");
});

/** Stepped work with one step a slice, as a long build's slices go. */
const runStepsOneAtATime = <A>(steps: Generator<void, A>, between: Effect.Effect<void>) =>
  pacedSteps(
    steps,
    () => ({ between, sliceMs: 1_000, maxSteps: 1 }),
    () => 0,
  );
