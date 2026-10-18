/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";

import { oneAtATime } from "./oneAtATime.ts";

describe("oneAtATime", () => {
  test("turns runs away while one is going, however many come", async () => {
    let starts = 0;
    const release = Effect.runSync(Deferred.make<void>());
    const guarded = oneAtATime(
      Effect.gen(function* () {
        starts += 1;
        yield* Deferred.await(release);
      }),
    );
    const first = Effect.runFork(guarded);
    await Effect.runPromise(Effect.yieldNow);
    // The runs turned away must not let a third one through.
    await Effect.runPromise(guarded);
    await Effect.runPromise(guarded);
    assert.equal(starts, 1);
    Effect.runSync(Deferred.succeed(release, undefined));
    await Effect.runPromise(Fiber.join(first));
    await Effect.runPromise(guarded);
    assert.equal(starts, 2);
  });

  test("runs again after a run that failed", async () => {
    let starts = 0;
    const guarded = oneAtATime(
      Effect.suspend(() => {
        starts += 1;
        return Effect.fail("no");
      }),
    );
    await Effect.runPromise(Effect.ignore(guarded));
    await Effect.runPromise(Effect.ignore(guarded));
    assert.equal(starts, 2);
  });
});
