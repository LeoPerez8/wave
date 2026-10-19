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
