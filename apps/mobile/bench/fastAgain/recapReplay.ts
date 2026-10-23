/** Actual selected Stats/store/cache replay; only clock, visibility and free turns are controlled. */
import * as Effect from "effect/Effect";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { RecapPeriod } from "@wave/core";
import type { FastAgainFixture } from "../../src/library/db/fastAgainFixture.ts";
import { traceQueries, type TracedQuery } from "../../src/library/db/testDatabase.ts";
import { freeTurnTasks } from "./cooperative.ts";
import { loadLibraryStore, loadWorktreeModule } from "./store.ts";

export const createRecapReplay = async (root: string, fixture: FastAgainFixture) => {
  const store = await loadLibraryStore(root, fixture.db);
  const statsModule = await loadWorktreeModule<typeof import("../../src/stats/Stats.ts")>(
    root,
    "apps/mobile/src/stats/Stats.ts",
  );
  const storeModule = await loadWorktreeModule<typeof import("../../src/library/LibraryStore.ts")>(
    root,
    "apps/mobile/src/library/LibraryStore.ts",
  );
  let tracing = false;
  const work = { reads: 0, rowsRead: 0, statements: 0, notifications: 0, maxRows: 0 };
  let queries: TracedQuery[] = [];
  let tasks: number[] = [];
  const { turn, end, start, open } = freeTurnTasks((ms) => tasks.push(ms));
  const traced = <A, E>(read: Effect.Effect<A, E>) =>
    Effect.sync(() => {
      if (!tracing) return Effect.runSync(read);
      const result = traceQueries(fixture.db, () => Effect.runSync(read));
      queries.push(...result.queries);
      work.rowsRead += result.queries.reduce((sum, query) => sum + query.rows, 0);
      work.statements += result.queries.length;
      work.maxRows = Math.max(work.maxRows, ...result.queries.map((query) => query.rows));
      return result.result;
    });
  const reads = {
    ...store,
    countedListening: traced(store.countedListening),
    countedListeningPage: (after: number) => traced(store.countedListeningPage(after)),
  };
  const stats = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* statsModule.Stats;
    }).pipe(
      Effect.provide(statsModule.layer),
      Effect.provideService(storeModule.LibraryStore, reads),
    ),
  );
  const source = stats.recaps as unknown;
  if (source === undefined) return null;
  let at = fixture.now;
  const jobs = new Map<number, { ms: number; run: () => void }>();
  let jobId = 0;
  let pending: Promise<unknown> | undefined;
  let failure: unknown;
  const read = (now: number, signal?: AbortSignal) => {
    work.reads++;
    open();
    const effect = typeof source === "function" ? source(now, turn) : source;
    pending = Effect.runPromise(effect as Effect.Effect<readonly RecapPeriod[], unknown>, {
      signal,
    });
    return pending as Promise<readonly RecapPeriod[]>;
  };
  const path = "apps/mobile/src/stats/recapAvailability.ts";
  const module = existsSync(resolve(root, path))
    ? await loadWorktreeModule<typeof import("../../src/stats/recapAvailability.ts")>(root, path)
    : null;
  const cache = module?.shareRecapAvailability({
    version: stats.recapHistoryVersion,
    now: () => at,
    monotonic: () => at,
    zone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    schedule: (ms, run) => {
      const key = ++jobId;
      jobs.set(key, { ms, run });
      return () => {
        jobs.delete(key);
      };
    },
    read: (now, signal) =>
      read(now, signal).catch((error) => {
        failure = error;
        throw error;
      }),
  });
  let value: readonly RecapPeriod[] | undefined;
  const clients: { setActive: (active: boolean) => void; detach: () => void }[] = [];
  let legacyActive = false;
  const legacyRefresh = () => {
    if (legacyActive) {
      const original = Date.now;
      Date.now = () => at;
      try {
        void read(at).then((next) => {
          value = next;
          work.notifications++;
        });
      } finally {
        Date.now = original;
      }
    }
  };
  return {
    store,
    stats,
    work,
    bounded: cache !== undefined,
    activate: (client: { setActive: (active: boolean) => void }) => {
      start();
      client.setActive(true);
      // Historical reads run inside activation; count that task once, through publication.
      if (cache !== undefined) end();
    },
    get: () => cache?.get() ?? value,
    queries: () => queries,
    tasks: () => tasks,
    at: (now: number) => {
      at = now;
      cache?.check();
    },
    attach: (initiallyActive: boolean) => {
      const client = cache?.attach(initiallyActive, () => {
        work.notifications++;
      }) ?? {
        setActive: (active: boolean) => {
          legacyActive = active;
          if (active) legacyRefresh();
        },
        detach: () => {
          legacyActive = false;
        },
      };
      clients.push(client);
      if (cache === undefined) {
        legacyActive = initiallyActive;
        legacyRefresh();
      }
      return client;
    },
    invalidate: () => {
      cache?.check();
      if (cache === undefined) legacyRefresh();
    },
    reset: (trace = false) => {
      tracing = trace;
      work.reads = work.rowsRead = work.statements = work.notifications = work.maxRows = 0;
      tasks = [];
      queries = [];
      failure = undefined;
    },
    drain: async () => {
      for (let round = 0; round < 20; round++) {
        for (const [key, job] of jobs)
          if (job.ms === 0) {
            jobs.delete(key);
            open();
            job.run();
          }
        await Promise.resolve();
        const reading = pending;
        pending = undefined;
        await reading;
        for (let i = 0; i < 8; i++) await Promise.resolve();
        end(); // Include publication and cache bookkeeping in the final synchronous task.
        if (failure !== undefined) throw failure;
        if (pending === undefined && ![...jobs.values()].some((job) => job.ms === 0)) return;
      }
      throw new Error("Recap replay did not settle");
    },
    close: () => {
      for (const client of clients) client.detach();
    },
  };
};
