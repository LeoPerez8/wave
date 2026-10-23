/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

import { SHARED_READ_ATTEMPTS, sharedRead } from "./sharedRead.ts";

class Store extends Context.Service<Store, { readonly value: number }>()("test/Store") {}

describe("A shared read", () => {
  test("a stalled recommendation source times out for all waiters, cancels paging, and can be retried", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let blocked = true;
    let turns = 0;
    const shared = sharedRead(
      Effect.suspend(() =>
        blocked
          ? Effect.callback<number>(() => {
              turns++;
              return Effect.sync(() => {
                turns--;
              });
            })
          : Effect.succeed(42),
      ),
    );
    const controllers = [new AbortController(), new AbortController()];
    const outcomes: string[] = [];
    const waiting = controllers.map((controller) =>
      Effect.runPromise(shared.get, { signal: controller.signal }).then(
        () => {
          outcomes.push("read");
        },
        () => {
          outcomes.push("failed");
        },
      ),
    );
    try {
      assert.equal(turns, 1, "the consumers wait on the same source");
      t.mock.timers.tick(60_000);
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(outcomes, ["failed", "failed"]);
      assert.equal(turns, 0, "no paging remains after its last waiter timed out");
      blocked = false;
      assert.equal(await Effect.runPromise(shared.get), 42);
    } finally {
      controllers.forEach((controller) => controller.abort());
      shared.dispose();
      await Promise.all(waiting);
    }
  });

  test("reads once for every ask, again once forgotten", async () => {
    let reads = 0;
    const shared = sharedRead(
      Effect.sync(() => {
        reads += 1;
        return reads;
      }),
    );
    const [a, b] = await Promise.all([
      Effect.runPromise(shared.get),
      Effect.runPromise(shared.get),
    ]);
    assert.deepEqual([a, b, reads], [1, 1, 1]);
    shared.forget();
    assert.equal(await Effect.runPromise(shared.get), 2);
  });

  test("doesn't keep a read that failed", async () => {
    let fail = true;
    const shared = sharedRead(
      Effect.suspend(() => (fail ? Effect.fail("unreadable") : Effect.succeed("read"))),
    );
    await assert.rejects(Effect.runPromise(shared.get));
    fail = false;
    assert.equal(await Effect.runPromise(shared.get), "read");
  });

  test("with a time to keep, reads again once it's past", async () => {
    let now = 0;
    let reads = 0;
    const shared = sharedRead(
      Effect.sync(() => {
        reads += 1;
        return reads;
      }),
      { keepMs: 60_000, now: () => now },
    );
    assert.equal(await Effect.runPromise(shared.get), 1);
    now = 60_000;
    assert.equal(await Effect.runPromise(shared.get), 1);
    now = 60_001;
    assert.equal(await Effect.runPromise(shared.get), 2);
  });

  test("reads with the services of whoever asked first", async () => {
    const shared = sharedRead(Effect.map(Effect.service(Store), (store) => store.value));
    const value = await Effect.runPromise(
      shared.get.pipe(Effect.provideService(Store, { value: 7 })),
    );
    assert.equal(value, 7);
  });
});

test("a forget mid-read interrupts the read and hands every waiter one fresh read", async () => {
  let starts = 0;
  let released = 0;
  const shared = sharedRead(
    Effect.gen(function* () {
      starts++;
      if (starts > 1) return 9;
      yield* Effect.callback<void>(() =>
        Effect.sync(() => {
          released++;
        }),
      );
      return 1;
    }),
  );
  const a = Effect.runPromise(shared.get);
  const b = Effect.runPromise(shared.get);
  const done = Promise.all([a, b]);
  shared.forget();
  const results = await Promise.race([
    done,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("waiters hung")), 300)),
  ]);
  assert.deepEqual(results, [9, 9]);
  assert.equal(released, 1);
  assert.equal(starts, 2, "the waiters share the one read after the forget");
  assert.equal(await Effect.runPromise(shared.get), 9);
  assert.equal(starts, 2);
});

test("an answer read before a forget is never handed out, even when its read can't be interrupted", async () => {
  let starts = 0;
  const finish: (() => void)[] = [];
  const shared = sharedRead(
    Effect.uninterruptible(
      Effect.callback<number>((resume) => {
        const version = ++starts;
        finish.push(() => resume(Effect.succeed(version)));
      }),
    ),
  );
  const waiting = Effect.runPromise(shared.get);
  await Promise.resolve();
  shared.forget();
  finish[0]!();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(starts, 2, "the waiter reads again once the old read settles");
  finish[1]!();
  assert.equal(await waiting, 2);
});

test("a read forgotten every time it starts fails its waiters after a bounded number of reads", async () => {
  let starts = 0;
  const shared = sharedRead(
    Effect.callback<number>(() => {
      starts++;
      queueMicrotask(() => shared.forget());
    }),
  );
  await assert.rejects(Effect.runPromise(shared.get), /Shared read invalidated/);
  assert.equal(starts, SHARED_READ_ATTEMPTS);
  // The bound is per ask: a later ask reads again.
  const later = assert.rejects(Effect.runPromise(shared.get), /Shared read invalidated/);
  await later;
  assert.equal(starts, 2 * SHARED_READ_ATTEMPTS);
});

test("dispose while waiters read again releases them permanently", async () => {
  let starts = 0;
  const shared = sharedRead(
    Effect.callback<number>(() => {
      starts++;
    }),
  );
  const waiting = Effect.runPromise(shared.get);
  const rejected = assert.rejects(waiting, /Shared read disposed/);
  await Promise.resolve();
  shared.forget();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(starts, 2);
  shared.dispose();
  await rejected;
  await assert.rejects(Effect.runPromise(shared.get), /Shared read disposed/);
  assert.equal(starts, 2);
});

test("one cancelled reader leaves its peer's build running; last cancellation gives up the task", async () => {
  let release: (() => void) | undefined;
  let stops = 0;
  const shared = sharedRead(
    Effect.callback<number>((resume) => {
      release = () => resume(Effect.succeed(7));
      return Effect.sync(() => {
        stops++;
      });
    }),
  );
  const controller = new AbortController();
  const first = Effect.runPromise(shared.get, { signal: controller.signal });
  const rejected = assert.rejects(first);
  const peer = Effect.runPromise(shared.get);
  controller.abort();
  await rejected;
  assert.equal(stops, 0);
  release!();
  assert.equal(await peer, 7);
  shared.forget();
  const lastController = new AbortController();
  const last = Effect.runPromise(shared.get, { signal: lastController.signal });
  const done = assert.rejects(last);
  lastController.abort();
  await done;
  assert.equal(stops, 1);
  const retry = Effect.runPromise(shared.get);
  release!();
  assert.equal(await retry, 7);
  shared.dispose();
  await assert.rejects(Effect.runPromise(shared.get));
});
