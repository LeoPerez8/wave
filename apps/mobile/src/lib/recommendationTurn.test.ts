import assert from "node:assert/strict";
import { test } from "node:test";
import * as Effect from "effect/Effect";
import { runTestPromise } from "./steppedTesting.ts";
import { createRecommendationWork } from "./recommendationTurn.ts";
import { namedWork, runSteps } from "./stepped.ts";

test("pages and ranking share a frame budget without queuing a turn per page or slice", async () => {
  let now = 0;
  const frames: (() => void)[] = [];
  const { turn } = createRecommendationWork({
    now: () => now,
    intervalMs: () => 1000 / 120,
    request: (run) => {
      frames.push(run);
      return () => {};
    },
  });
  let pages = 0;
  let ranked = 0;
  const result = runTestPromise(
    Effect.gen(function* () {
      for (; pages < 3; pages++) {
        yield* turn;
        now += 2;
      }
      return yield* runSteps(
        (function* () {
          for (; ranked < 20; ranked++) {
            now++;
            yield;
          }
          return "ranked";
        })(),
        turn,
        () => now,
      );
    }),
  );
  assert.equal(pages, 3);
  assert.equal(frames.length, 1);
  assert.ok(ranked > 0, "CPU uses the rest of the frame without a separate start turn");
  while (frames.length > 0) {
    frames.shift()!();
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.equal(await result, "ranked");
  assert.equal(ranked, 20);
});

test("concurrent readers share rendering frames and cancellation releases the last pending frame", async () => {
  let now = 0;
  const frames = new Set<() => void>();
  const { turn } = createRecommendationWork({
    now: () => now,
    intervalMs: () => 1000 / 120,
    request: (run) => {
      frames.add(run);
      return () => {
        frames.delete(run);
      };
    },
  });
  now = 8;
  const a = new AbortController();
  const b = new AbortController();
  const first = runTestPromise(turn, { signal: a.signal });
  const second = runTestPromise(turn, { signal: b.signal });
  const stopped = assert.rejects(first);
  assert.equal(frames.size, 1, "readers share the upcoming frame, not serial turns");
  a.abort();
  await stopped;
  assert.equal(frames.size, 1, "a live peer retains the frame");
  frames.values().next().value!();
  await second;
  assert.equal(frames.size, 0);
  now = 16;
  const pending = runTestPromise(turn, { signal: b.signal });
  const cancelled = assert.rejects(pending);
  b.abort();
  await cancelled;
  assert.equal(frames.size, 0);
});

test("recommendation turns wait out a tap's transition; work someone waits for doesn't", async () => {
  let inFlight = true;
  const after: (() => void)[] = [];
  const work = createRecommendationWork({
    now: () => 0,
    intervalMs: () => 1000 / 120,
    request: () => () => {},
    transition: {
      inFlight: () => inFlight,
      after: (run) => {
        after.push(run);
        return () => {
          const index = after.indexOf(run);
          if (index !== -1) after.splice(index, 1);
        };
      },
    },
  });
  let turned = false;
  const background = runTestPromise(work.turn).then(() => {
    turned = true;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(turned, false);
  assert.equal(after.length, 1);
  const awaited = await runTestPromise(
    work.steps(
      (function* () {
        yield;
        return "for the tap";
      })(),
      () => true,
    ),
  );
  assert.equal(awaited, "for the tap");
  inFlight = false;
  after.shift()!();
  await background;
  assert.equal(turned, true);
});

test("a recommendation turn hands the block log to the work that takes it (#1447)", async () => {
  let now = 0;
  const frames: (() => void)[] = [];
  const marks: string[] = [];
  const { turn } = createRecommendationWork({
    now: () => now,
    intervalMs: () => 1000 / 120,
    request: (run) => {
      frames.push(run);
      return () => {};
    },
    turnTaken: (name) => marks.push(`${name} at ${now}`),
  });
  // Pages read after a frame-paced turn run outside any slice: the mark is what names them.
  const pages = runTestPromise(
    Effect.gen(function* () {
      for (let page = 0; page < 2; page++) {
        yield* turn.pipe(namedWork("Discover mixes"));
        now += 1;
      }
    }),
  );
  assert.deepEqual(marks, ["Discover mixes at 0", "Discover mixes at 1"]);
  assert.equal(frames.length, 0);
  now = 20;
  const waiting = runTestPromise(turn.pipe(namedWork("Similar artists")));
  assert.deepEqual(marks.slice(2), [], "not marked before the frame it waits for");
  now = 30;
  frames.shift()!();
  await waiting;
  await pages;
  assert.deepEqual(marks.slice(2), ["Similar artists at 30"]);
});
