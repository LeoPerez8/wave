/** Benchmark adapter for the app's injected free turns. No native scheduler/paint claim. */
import * as Effect from "effect/Effect";
import { performance } from "node:perf_hooks";
import { setImmediate } from "node:timers/promises";
import { percentiles } from "./measure.ts";
import {
  traceQueries,
  observeSqlTasks,
  type TestDatabase,
} from "../../src/library/db/testDatabase.ts";

const round = (value: number) => Number(value.toFixed(3));
/** Times complete JS tasks between injected free turns; `turn` ends the open task, then yields. */
export const freeTurnTasks = (onTask: (ms: number) => void) => {
  let started: number | undefined;
  const end = () => {
    if (started !== undefined) onTask(performance.now() - started);
    started = undefined;
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
  return {
    turn,
    end,
    /** Opens a task now, replacing any open one. */
    start: () => {
      started = performance.now();
    },
    /** Opens a task unless one is already open. */
    open: () => {
      started ??= performance.now();
    },
  };
};
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
  const sqlTotals: number[] = [],
    sqlLongest: number[] = [],
    cpuLongest: number[] = [];
  const sqlByStatement = new Map<string, { count: number; totalMs: number; longestMs: number }>();
  let cpuMicros = 0;
  for (let i = 0; i < runs; i++) {
    const tasks: number[] = [];
    const cpuTasks: number[] = [];
    let taskSql = 0,
      sqlTotal = 0,
      maxSql = 0;
    const { turn, end } = freeTurnTasks((ms) => {
      tasks.push(ms);
      if (taskSql === 0) cpuTasks.push(ms);
      taskSql = 0;
    });
    const cpu = process.cpuUsage();
    const start = performance.now();
    const stopSql = observeSqlTasks(db, (sql, ms) => {
      taskSql++;
      sqlTotal += ms;
      maxSql = Math.max(maxSql, ms);
      const entry = sqlByStatement.get(sql) ?? { count: 0, totalMs: 0, longestMs: 0 };
      entry.count++;
      entry.totalMs += ms;
      entry.longestMs = Math.max(entry.longestMs, ms);
      sqlByStatement.set(sql, entry);
    });
    let result: A;
    try {
      result = await Effect.runPromise(run(turn));
    } finally {
      stopSql();
    }
    end();
    const used = process.cpuUsage(cpu);
    cpuMicros += used.user + used.system;
    elapsed.push(performance.now() - start);
    totals.push(tasks.reduce((sum, ms) => sum + ms, 0));
    longest.push(Math.max(0, ...tasks));
    sliceCounts.push(tasks.length);
    sqlTotals.push(sqlTotal);
    sqlLongest.push(maxSql);
    cpuLongest.push(Math.max(0, ...cpuTasks));
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
      sql: {
        totalMs: percentiles(sqlTotals),
        longestStatementMs: round(Math.max(...sqlLongest)),
        longestStatementSamplesMs: sqlLongest.map(round),
        statements: [...sqlByStatement].map(([sql, value]) => ({
          sql,
          count: value.count,
          totalMs: round(value.totalMs),
          longestMs: round(value.longestMs),
        })),
        boundary:
          "sql.js prepare through free, including row delivery; excludes Drizzle mapping after free; observer overhead included",
      },
      longestTaskWithoutSqlSamplesMs: cpuLongest.map(round),
      source:
        "actual selected-worktree app effects; setImmediate represents the injected free-turn scheduler; SQL reads are indivisible tasks",
      omitted: "native paint, React, scheduler quiet waits and animation; no phone/Hermes claim",
      queries: traced.queries.map((q) => ({ sql: q.sql, rows: q.rows })),
    },
  };
};
