import assert from "node:assert/strict";
import { test } from "node:test";
import * as Effect from "effect/Effect";
import { settledTurn } from "./settledWork.ts";
import { sharedRead } from "./sharedRead.ts";

test("cold playlist and mix/Magic Queue readers share work only after settlement and a free turn", async () => {
  let settled = false;
  let reads = 0;
  const listeners = new Set<() => void>();
  const queue = new Set<() => void>();
  const gate = settledTurn({
    settled: () => settled,
    subscribe: (f) => {
      listeners.add(f);
      return () => {
        listeners.delete(f);
      };
    },
    schedule: (f) => {
      queue.add(f);
      return () => {
        queue.delete(f);
      };
    },
  });
  const shared = sharedRead(gate.pipe(Effect.andThen(Effect.sync(() => ++reads))));
  const playlist = Effect.runPromise(shared.get);
  const mix = Effect.runPromise(shared.get);
  assert.equal(reads, 0);
  settled = true;
  for (const f of listeners) f();
  assert.equal(reads, 0);
  for (const f of queue) {
    queue.delete(f);
    f();
  }
  assert.deepEqual(await Promise.all([playlist, mix]), [1, 1]);
  assert.equal(listeners.size, 0);
  assert.equal(await Effect.runPromise(shared.get), 1);
  assert.equal(reads, 1);
});

test("a new transition postpones a queued turn; cancellation removes the settlement observer and task", async () => {
  let settled = true;
  const listeners = new Set<() => void>(),
    queue = new Set<() => void>();
  const gate = settledTurn({
    settled: () => settled,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    schedule: (run) => {
      queue.add(run);
      return () => {
        queue.delete(run);
      };
    },
  });
  let work = 0;
  const first = Effect.runPromise(
    gate.pipe(
      Effect.andThen(
        Effect.sync(() => {
          work++;
        }),
      ),
    ),
  );
  settled = false;
  for (const run of queue) {
    queue.delete(run);
    run();
  }
  assert.equal(work, 0);
  assert.equal(listeners.size, 1);
  settled = true;
  for (const listener of listeners) listener();
  for (const run of queue) {
    queue.delete(run);
    run();
  }
  await first;
  assert.equal(work, 1);
  assert.equal(listeners.size, 0);
  const abort = new AbortController();
  const pending = Effect.runPromise(gate, { signal: abort.signal }),
    rejected = assert.rejects(pending);
  assert.equal(queue.size, 1);
  abort.abort();
  await rejected;
  assert.equal(queue.size, 0);
  assert.equal(listeners.size, 0);
});
