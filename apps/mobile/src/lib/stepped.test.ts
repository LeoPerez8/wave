import assert from "node:assert/strict";
import { test } from "node:test";
import * as Effect from "effect/Effect";
import { namedWork, runSteps, shareSlicesWith } from "./stepped.ts";
test("CPU work stays within its 6 ms of the 8 ms slice and operation cap with an explicit scheduler", () => {
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
    ).pipe(namedWork("test")),
  );
  assert.equal(result, "done");
  assert.ok(turns > 60);
  // A clock that never runs out leaves only the operation cap: 512 operations per task.
  const cappedTurns: number[] = [];
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
        cappedTurns.push(capped);
      }),
      () => 0,
    ).pipe(namedWork("test")),
  );
  assert.deepEqual(cappedTurns, [0, 512, 1024]);
});

test("cancelling stepped work closes its iterator and releases the scheduled turn", async () => {
  let closed = false,
    turns = 0,
    cancelled = 0;
  const steps = (function* () {
    try {
      for (;;) yield;
    } finally {
      closed = true;
    }
  })();
  const between = Effect.suspend(() => {
    turns++;
    return turns === 1
      ? Effect.void
      : Effect.callback<void>(() =>
          Effect.sync(() => {
            cancelled++;
          }),
        );
  });
  const abort = new AbortController();
  const pending = Effect.runPromise(runSteps(steps, between, () => 0).pipe(namedWork("test")), {
    signal: abort.signal,
  });
  const rejected = assert.rejects(pending);
  abort.abort();
  await rejected;
  assert.equal(closed, true);
  assert.equal(cancelled, 1);
});

test("each slice goes to the shared scheduler under the name of the work running it", () => {
  const names: string[] = [];
  const stop = shareSlicesWith((name, steps) => {
    names.push(name);
    const next = steps.next();
    return next.done === true ? { done: true, value: next.value } : { done: false };
  });
  try {
    const steps = (function* () {
      yield;
      return "ranked";
    })();
    const result = Effect.runSync(namedWork("Magic Queue batch")(runSteps(steps, Effect.void)));
    assert.equal(result, "ranked");
    assert.deepEqual(names, ["Magic Queue batch", "Magic Queue batch"]);
  } finally {
    stop();
  }
});

test("stepped work that no caller names doesn't run (#1447)", () => {
  const names: string[] = [];
  const stop = shareSlicesWith((name, steps) => {
    names.push(name);
    const next = steps.next();
    return next.done === true ? { done: true, value: next.value } : { done: false };
  });
  try {
    const unnamed = runSteps((function* () {})(), Effect.void);
    // @ts-expect-error -- a run needs the work's name: the type keeps an unnamed call site out.
    assert.throws(() => Effect.runSync(unnamed));
    assert.deepEqual(names, []);
  } finally {
    stop();
  }
});
