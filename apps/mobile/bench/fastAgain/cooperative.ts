/** Benchmark adapter for the app's injected free turns. No native scheduler/paint claim. */
import * as Effect from "effect/Effect";
import { performance } from "node:perf_hooks";
import { setImmediate } from "node:timers/promises";
import { percentiles } from "./measure.ts";
import { traceQueries, type TestDatabase } from "../../src/library/db/testDatabase.ts";

const round = (value: number) => Number(value.toFixed(3));
export const measureCooperative = async <A>(
  db: TestDatabase,
  read: string,
  runs: number,
  run: (turn: Effect.Effect<void>) => Effect.Effect<A, unknown>,
  resultKey: (result: A) => string,
) => {
  const traced = traceQueries(db, () => Effect.runSync(run(Effect.void)));
  const expected = resultKey(traced.result);
  const totals: number[] = [];
  const elapsed: number[] = [];
  const longest: number[] = [];
  const sliceCounts: number[] = [];
  let cpuMicros = 0;
  for (let i = 0; i < runs; i++) {
    const tasks: number[] = [];
    let started: number | undefined;
    const end = () => {
      if (started !== undefined) {
        tasks.push(performance.now() - started);
        started = undefined;
      }
    };
    const turn = Effect.suspend(() => {
      end();
      return Effect.promise(() => setImmediate()).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            started = performance.now();
          }),
        ),
      );
    });
    const cpu = process.cpuUsage();
    const start = performance.now();
    const result = await Effect.runPromise(run(turn));
    end();
    const used = process.cpuUsage(cpu);
    cpuMicros += used.user + used.system;
    elapsed.push(performance.now() - start);
    totals.push(tasks.reduce((sum, ms) => sum + ms, 0));
    longest.push(Math.max(0, ...tasks));
    sliceCounts.push(tasks.length);
    if (resultKey(result) !== expected) throw new Error(`${read}: nondeterministic result`);
  }
  return {
    read,
    ...percentiles(totals),
    cpuMs: round(cpuMicros / 1000 / runs),
    rowsRead: traced.queries.reduce((sum, q) => sum + q.rows, 0),
    statements: traced.queries.length,
    longestSyncTaskMs: round(Math.max(...longest)),
    notifications: 0,
    resultKey: expected,
    details: {
      totalSynchronousJsMs: percentiles(totals),
      elapsedReplayMs: percentiles(elapsed),
      longestTaskSamplesMs: longest.map(round),
      taskCounts: sliceCounts,
      source:
        "actual selected-worktree app effects; setImmediate represents the injected free-turn scheduler; SQL reads are indivisible tasks",
      omitted: "native paint, React, scheduler quiet waits and animation; no phone/Hermes claim",
      queries: traced.queries.map((q) => ({ sql: q.sql, rows: q.rows })),
    },
  };
};
