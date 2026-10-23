/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

import { sharedRead } from "./sharedRead.ts";

class Store extends Context.Service<Store, { readonly value: number }>()("test/Store") {}

describe("A shared read", () => {
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

test("invalidation interrupts a suspended shared build and releases all waiters", async () => {
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
  // Register rejection handlers before invalidation.
  const done = Promise.allSettled([a, b]);
  shared.forget();
  assert.equal(await Effect.runPromise(shared.get), 9);
  const results = await Promise.race([
    done,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("waiters hung")), 300)),
  ]);
  assert.deepEqual(
    results.map((r) => r.status),
    ["rejected", "rejected"],
  );
  assert.equal(released, 1);
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
