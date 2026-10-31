import assert from "node:assert/strict";
import { test } from "node:test";
import * as Effect from "effect/Effect";
import { createRecommendationWork } from "./recommendationTurn.ts";
import { runSteps } from "./stepped.ts";

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
  const result = Effect.runPromise(
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
  const first = Effect.runPromise(turn, { signal: a.signal });
  const second = Effect.runPromise(turn, { signal: b.signal });
  const stopped = assert.rejects(first);
  assert.equal(frames.size, 1, "readers share the upcoming frame, not serial turns");
  a.abort();
  await stopped;
  assert.equal(frames.size, 1, "a live peer retains the frame");
  frames.values().next().value!();
  await second;
  assert.equal(frames.size, 0);
  now = 16;
  const pending = Effect.runPromise(turn, { signal: b.signal });
  const cancelled = assert.rejects(pending);
  b.abort();
  await cancelled;
  assert.equal(frames.size, 0);
});
