import assert from "node:assert/strict";
import { test } from "node:test";
import * as Effect from "effect/Effect";
import { openWhileBackgrounded, settledTurn } from "./settledWork.ts";
import { sharedRead } from "./sharedRead.ts";

test("a screen that never settles releases work on a free turn after three seconds", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const listeners = new Set<() => void>();
  const queue = new Set<() => void>();
  const gate = settledTurn({
    settled: () => false,
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
  const waiting = Effect.runPromise(gate);
  t.mock.timers.tick(2999);
  assert.equal(queue.size, 0);
  t.mock.timers.tick(1);
  assert.equal(queue.size, 1, "the cap requests a free turn even without settlement");
  for (const f of queue) {
    queue.delete(f);
    f();
  }
  await waiting;
  assert.equal(listeners.size, 0);
});

test("cancelling a never-settled wait removes its observer and prevents the fallback turn", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const listeners = new Set<() => void>();
  const queue = new Set<() => void>();
  const gate = settledTurn({
    settled: () => false,
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
  const controller = new AbortController();
  const rejected = assert.rejects(Effect.runPromise(gate, { signal: controller.signal }));
  controller.abort();
  await rejected;
  t.mock.timers.tick(3000);
  assert.equal(listeners.size, 0);
  assert.equal(queue.size, 0);
});

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

test("backgrounded, with no screen to protect, a settled turn opens without settlement; back, it waits again", async () => {
  let settled = false;
  let away = false;
  const listeners = new Set<() => void>();
  const subscribe = (f: () => void) => {
    listeners.add(f);
    return () => {
      listeners.delete(f);
    };
  };
  const queue = new Set<() => void>();
  const gate = settledTurn({
    ...openWhileBackgrounded(
      { settled: () => settled, subscribe },
      { backgrounded: () => away, subscribe },
    ),
    schedule: (f) => {
      queue.add(f);
      return () => {
        queue.delete(f);
      };
    },
  });
  const flush = () => {
    for (const f of queue) {
      queue.delete(f);
      f();
    }
  };
  let ran = 0;
  const first = Effect.runPromise(gate.pipe(Effect.andThen(Effect.sync(() => ran++))));
  flush();
  await Promise.resolve();
  assert.equal(ran, 0); // Foreground and unsettled: it waits.
  away = true; // A locked phone or Android Auto: nothing on screen to protect.
  for (const f of listeners) f();
  flush();
  await first;
  assert.equal(ran, 1);
  away = false;
  const second = Effect.runPromise(gate.pipe(Effect.andThen(Effect.sync(() => ran++))));
  flush();
  await Promise.resolve();
  assert.equal(ran, 1);
  settled = true;
  for (const f of listeners) f();
  flush();
  await second;
  assert.equal(ran, 2);
  assert.equal(listeners.size, 0);
});
