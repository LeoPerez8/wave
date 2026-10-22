import assert from "node:assert/strict";
import { test } from "node:test";
import * as Effect from "effect/Effect";
import { runSteps } from "./stepped.ts";
test("CPU work respects the 6ms target and operation cap with an explicit scheduler", () => {
  let clock = 0,
    work = 0,
    previous = 0,
    turns = 0;
  const tasks = (function* () {
    for (let i = 0; i < 400; i++) {
      work++;
      yield;
    }
    return "done";
  })();
  const result = Effect.runSync(
    runSteps(
      tasks,
      Effect.sync(() => {
        assert.ok(work - previous <= 6);
        previous = work;
        turns++;
      }),
      () => clock++,
    ),
  );
  assert.equal(result, "done");
  assert.ok(turns > 60);
  let capped = 0;
  Effect.runSync(
    runSteps(
      (function* () {
        for (let i = 0; i < 1200; i++) {
          capped++;
          yield;
        }
      })(),
      Effect.sync(() => {
        assert.ok(capped <= 1024);
      }),
      () => 0,
    ),
  );
});
