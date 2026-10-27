import assert from "node:assert/strict";
import { test } from "node:test";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";

import { lazyService } from "./lazyService.ts";

class Store extends Context.Service<Store, { readonly name: string }>()("test/Store") {}

class Recaps extends Context.Service<
  Recaps,
  {
    readonly count: Effect.Effect<number>;
    readonly titled: (year: number) => Effect.Effect<string>;
  }
>()("test/Recaps") {}

const storeLayer = Layer.succeed(Store, { name: "Library" });

/** A Recaps layer whose implementation counts how often it was built. */
const recapsLayer = () => {
  const built = { times: 0 };
  const layer = lazyService(Recaps, () =>
    Effect.gen(function* () {
      built.times += 1;
      const store = yield* Store;
      return {
        count: Effect.succeed(3),
        titled: (year: number) => Effect.succeed(`${store.name} ${year}`),
      };
    }),
  );
  return { built, runtime: ManagedRuntime.make(layer.pipe(Layer.provide(storeLayer))) };
};

test("the app's services start without building a lazy service", async () => {
  const { built, runtime } = recapsLayer();
  // Another service's use builds the whole layer, as a launch does.
  await runtime.runPromise(Effect.void);
  await runtime.runPromise(Effect.gen(function* () {
    yield* Recaps;
  }));
  assert.equal(built.times, 0);
  await runtime.dispose();
});

test("its first use builds it once, with what it needs, behind the same interface", async () => {
  const { built, runtime } = recapsLayer();
  const read = Effect.gen(function* () {
    const recaps = yield* Recaps;
    return [yield* recaps.count, yield* recaps.titled(2026)] as const;
  });
  assert.deepEqual(await runtime.runPromise(read), [3, "Library 2026"]);
  assert.deepEqual(await runtime.runPromise(read), [3, "Library 2026"]);
  assert.equal(built.times, 1);
  await runtime.dispose();
});
