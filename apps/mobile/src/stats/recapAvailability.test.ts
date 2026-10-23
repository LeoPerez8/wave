import type { RecapPeriod } from "@wave/core";
import assert from "node:assert/strict";
import { test } from "node:test";
import { makeExternalStore } from "../lib/externalStore.ts";
import { shareRecapAvailability } from "./recapAvailability.ts";

const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

test("hidden invalidations coalesce; shared settled clients retain good data through cancellation, stale answers and errors", async () => {
  const version = makeExternalStore(0);
  const jobs = new Map<number, { ms: number; run: () => void }>();
  let id = 0;
  let wall = new Date(2026, 10, 30, 23, 59).getTime();
  let mono = 0;
  const pending: {
    signal: AbortSignal;
    resolve: (value: readonly RecapPeriod[]) => void;
    reject: (error: Error) => void;
  }[] = [];
  const cache = shareRecapAvailability({
    version,
    now: () => wall,
    monotonic: () => mono,
    zone: () => "test",
    schedule: (ms, run) => {
      const key = ++id;
      jobs.set(key, { ms, run });
      return () => {
        jobs.delete(key);
      };
    },
    read: (_now, signal) =>
      new Promise((resolve, reject) => pending.push({ signal, resolve, reject })),
  });
  const start = async () => {
    for (const [key, job] of jobs)
      if (job.ms === 0) {
        jobs.delete(key);
        job.run();
      }
    await flush();
  };
  let notifications = 0;
  const one = cache.attach(false, () => notifications++);
  const two = cache.attach(false, () => notifications++);
  version.set(1);
  version.set(2);
  await start();
  assert.equal(pending.length, 0);
  one.setActive(true);
  two.setActive(true);
  await start();
  assert.equal(pending.length, 1);
  const november = [{ kind: "month", year: 2026, month: 10 }] as const;
  pending[0]!.resolve(november);
  await flush();
  assert.deepEqual(cache.get(), november);
  assert.equal(notifications, 2);
  one.setActive(false);
  two.setActive(false);
  one.setActive(true);
  await start();
  assert.equal(pending.length, 1, "unchanged return and Now Playing close reuse availability");
  version.set(3);
  await start();
  version.set(4);
  assert.equal(
    pending[1]!.signal.aborted,
    true,
    "a committed history change aborts active stale work",
  );
  one.setActive(false);
  version.set(5);
  one.setActive(true);
  await start();
  assert.equal(pending.length, 2, "one in-flight reader until cancelled work releases");
  pending[1]!.resolve([]);
  await flush();
  await start();
  assert.deepEqual(cache.get(), november);
  pending[2]!.reject(new Error("store failed"));
  await flush();
  assert.deepEqual(cache.get(), november);
  assert.equal(notifications, 2);
  cache.check();
  await start();
  pending[3]!.resolve(november);
  await flush();
  assert.equal(notifications, 2, "equal refresh never republishes");
  wall += 60_000;
  mono += 60_000;
  cache.check();
  await start();
  assert.equal(pending.length, 5, "December boundary invalidates unchanged history");
  pending[4]!.resolve([{ kind: "year", year: 2026 }]);
  await flush();
  assert.equal(notifications, 4);
  one.detach();
  two.detach();
  assert.equal(jobs.size, 0);
});

test("same-month clock jumps and timezone changes refresh once; ordinary clock progress is cached", async () => {
  const version = makeExternalStore(0);
  let wall = new Date(2026, 5, 10).getTime();
  let mono = 0;
  let zone = "America/Sao_Paulo";
  const jobs = new Map<number, { ms: number; run: () => void }>();
  let jobId = 0;
  let reads = 0;
  const cache = shareRecapAvailability({
    version,
    now: () => wall,
    monotonic: () => mono,
    zone: () => zone,
    schedule: (ms, run) => {
      const id = ++jobId;
      jobs.set(id, { ms, run });
      return () => {
        jobs.delete(id);
      };
    },
    read: async () => {
      reads++;
      return [];
    },
  });
  const drain = async () => {
    for (const [id, job] of jobs)
      if (job.ms === 0) {
        jobs.delete(id);
        job.run();
      }
    await flush();
  };
  const client = cache.attach(true, () => {});
  await drain();
  assert.equal(reads, 1);
  wall += 1000;
  mono += 1000;
  cache.check();
  await drain();
  assert.equal(reads, 1);
  zone = "Pacific/Kiritimati";
  cache.check();
  await drain();
  assert.equal(reads, 2);
  wall -= 86400000;
  cache.check();
  await drain();
  assert.equal(reads, 3, "backward clock jump inside the same month invalidates");
  wall += 2 * 86400000;
  cache.check();
  await drain();
  assert.equal(reads, 4, "forward clock jump inside the same month invalidates");
  client.detach();
  assert.equal(jobs.size, 0);
});

test("the production visibility binding waits for real timing settlement and cancels immediately on sheet coverage", async () => {
  const { observeRecapAvailability } = await import("./recapAvailability.ts");
  const { createTimingSession } = await import("../lib/timingSession.ts");
  const session = createTimingSession({
    now: () => 0,
    wallNow: () => 0,
    write: () => {},
    context: () => ({ background: [], offline: true }),
    build: () => ({ version: "test", commit: "test" }),
  });
  const version = makeExternalStore(0);
  const sight = makeExternalStore(true);
  const jobs = new Map<number, { ms: number; run: () => void }>();
  let id = 0;
  let reads = 0;
  const cache = shareRecapAvailability({
    version,
    now: () => 0,
    monotonic: () => 0,
    zone: () => "test",
    schedule: (ms, run) => {
      const key = ++id;
      jobs.set(key, { ms, run });
      return () => {
        jobs.delete(key);
      };
    },
    read: async () => {
      reads++;
      return [];
    },
  });
  const drain = async () => {
    for (const [key, job] of jobs)
      if (job.ms === 0) {
        jobs.delete(key);
        job.run();
      }
    await flush();
  };
  const stop = observeRecapAvailability(
    cache,
    {
      get: () => sight.get() && session.isSettled(),
      subscribe: (changed) => {
        const a = sight.subscribe(changed);
        const b = session.onSettled(changed);
        return () => {
          a();
          b();
        };
      },
    },
    () => {},
  );
  const home = session.begin("tab", "/(tabs)");
  await drain();
  assert.equal(reads, 0);
  session.response(home);
  session.frame(home);
  session.end(home);
  await drain();
  assert.equal(reads, 0, "animation end without drawn content is not settlement");
  session.content(home);
  await drain();
  assert.equal(reads, 1);
  version.set(1);
  sight.set(false); // Now Playing covers Home synchronously, before React effects.
  await drain();
  assert.equal(reads, 1);
  version.set(2);
  version.set(3);
  const returning = session.begin("nowPlayingClose", "/(tabs)");
  sight.set(true);
  await drain();
  assert.equal(reads, 1);
  session.response(returning);
  session.frame(returning);
  session.content(returning);
  session.end(returning);
  await drain();
  assert.equal(reads, 2);
  stop();
  assert.equal(jobs.size, 0);
});

test("covering Home before the queued reader enters performs no read", async () => {
  const jobs = new Map<number, { ms: number; run: () => void }>();
  let id = 0;
  let reads = 0;
  const cache = shareRecapAvailability({
    version: makeExternalStore(0),
    now: () => 0,
    monotonic: () => 0,
    zone: () => "test",
    schedule: (ms, run) => {
      const key = ++id;
      jobs.set(key, { ms, run });
      return () => {
        jobs.delete(key);
      };
    },
    read: async () => {
      reads++;
      return [];
    },
  });
  const home = cache.attach(true, () => {});
  for (const [key, job] of jobs)
    if (job.ms === 0) {
      jobs.delete(key);
      job.run();
    }
  home.setActive(false);
  await flush();
  assert.equal(reads, 0, "sheet coverage cancels before entering the reader microtask");
  assert.equal(cache.get(), undefined);
  home.detach();
  assert.equal(jobs.size, 0);
});

test("a calendar boundary crossed before the deferred start needs only one current refresh", async () => {
  let wall = new Date(2026, 9, 31, 23, 59).getTime();
  const jobs = new Map<number, { ms: number; run: () => void }>();
  let id = 0;
  let reads = 0;
  const cache = shareRecapAvailability({
    version: makeExternalStore(0),
    now: () => wall,
    monotonic: () => wall,
    zone: () => "test",
    schedule: (ms, run) => {
      const key = ++id;
      jobs.set(key, { ms, run });
      return () => {
        jobs.delete(key);
      };
    },
    read: async (at) => {
      reads++;
      assert.equal(at, wall);
      return [];
    },
  });
  const home = cache.attach(true, () => {});
  wall += 60_000;
  for (let turn = 0; turn < 3; turn++) {
    for (const [key, job] of jobs)
      if (job.ms === 0) {
        jobs.delete(key);
        job.run();
      }
    await flush();
  }
  assert.deepEqual(cache.get(), []);
  assert.equal(reads, 1, "the queued refresh captures the key at its actual start");
  home.detach();
});
