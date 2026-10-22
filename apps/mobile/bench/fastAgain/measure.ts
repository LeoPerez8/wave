import { performance } from "node:perf_hooks";
import { traceQueries, type TestDatabase } from "../../src/library/db/testDatabase.ts";
import type { ReadMeasurement } from "./types.ts";

const round = (n: number): number => Number(n.toFixed(3));
export const percentiles = (samples: readonly number[]) => {
  if (samples.length === 0) throw new Error("empty timing samples");
  const sorted = samples.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    medianMs: round(
      sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!,
    ),
    p90Ms: round(sorted[Math.ceil(sorted.length * 0.9) - 1]!),
  };
};
export interface MeasureOptions<A = unknown> {
  readonly runs?: number;
  /** Cumulative subscriber notification counter; delta for one traced operation. */
  readonly notifications?: () => number;
  readonly resultKey?: (result: A) => string;
  readonly details?: Readonly<Record<string, unknown>>;
}

/** Warm once; trace one operation outside wall/CPU timing; then time runs individually. */
export const measureRead = <A>(
  db: TestDatabase,
  read: string,
  run: () => A,
  options: MeasureOptions<A> = {},
): ReadMeasurement => {
  const runs = options.runs ?? 11;
  if (!Number.isInteger(runs) || runs < 1) throw new Error("runs must be a positive integer");
  const synchronous = () => {
    const result = run();
    if (result instanceof Promise)
      throw new Error("measureRead needs a synchronous read; measure async steps explicitly");
    return result;
  };
  synchronous();
  const beforeNotifications = options.notifications?.() ?? 0;
  const { queries, result } = traceQueries(db, synchronous);
  const notifications = (options.notifications?.() ?? 0) - beforeNotifications;
  const wall: number[] = [];
  const cpu = process.cpuUsage();
  for (let i = 0; i < runs; i++) {
    const before = performance.now();
    synchronous();
    wall.push(performance.now() - before);
  }
  const used = process.cpuUsage(cpu);
  return {
    read,
    ...percentiles(wall),
    cpuMs: round((used.user + used.system) / 1000 / runs),
    rowsRead: queries.reduce((sum, q) => sum + q.rows, 0),
    statements: queries.length,
    longestSyncTaskMs: round(Math.max(...wall)),
    notifications,
    ...(options.resultKey === undefined ? {} : { resultKey: options.resultKey(result) }),
    ...(options.details === undefined ? {} : { details: options.details }),
  };
};
