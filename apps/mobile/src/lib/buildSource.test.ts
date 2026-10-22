import assert from "node:assert/strict";
import { test } from "node:test";
import * as Effect from "effect/Effect";
import { createBuildSource } from "./buildSource.ts";

test("a source change cancels a suspended build, discards its output and restarts from the new version", async () => {
  const source = createBuildSource();
  let attempts = 0,
    released = 0;
  const read = Effect.gen(function* () {
    attempts++;
    if (attempts === 1)
      yield* Effect.callback<void>(() =>
        Effect.sync(() => {
          released++;
        }),
      );
    return attempts;
  });
  const result = Effect.runPromise(source.run(read, Effect.void));
  source.changed();
  assert.equal(await result, 2);
  assert.equal(released, 1);
});

test("a build that reads one version publishes it once, and a failure is not retried", async () => {
  const source = createBuildSource();
  let reads = 0;
  assert.equal(
    await Effect.runPromise(
      source.run(
        Effect.sync(() => ++reads),
        Effect.void,
      ),
    ),
    1,
  );
  await assert.rejects(
    Effect.runPromise(
      source.run(
        Effect.sync(() => {
          reads++;
        }).pipe(Effect.andThen(Effect.fail(new Error("unreadable")))),
        Effect.void,
      ),
    ),
    /unreadable/,
  );
  assert.equal(reads, 2);
});
