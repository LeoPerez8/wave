/** Maximum synchronous Library read time before it is named in the app log. */
export const SLOW_READ_BUDGET_MS = 16;

/** A synchronous Library read, with the screen that was showing when it ran. */
export interface SlowRead {
  readonly operation: string;
  readonly rows: number;
  readonly durationMs: number;
  readonly route: string;
}

/** No line at or under budget. Kept independent of perf-build instrumentation. */
export const slowReadLine = (read: SlowRead): string | null => {
  if (!(read.durationMs > SLOW_READ_BUDGET_MS)) return null;
  const duration =
    read.durationMs < 1_000
      ? `${Math.round(read.durationMs)} ms`
      : `${(read.durationMs / 1_000).toFixed(1)} s`;
  return `Read ${JSON.stringify(read.operation)} held JS ${duration} (${read.rows.toLocaleString("en-US")} ${read.rows === 1 ? "row" : "rows"}) on ${read.route}`;
};

/** One app-log entry for consecutive slow reads, without losing their details. */
export const slowReadsLine = (reads: readonly SlowRead[]): string | null => {
  const lines = reads.flatMap((read) => slowReadLine(read) ?? []);
  return lines.length === 0 ? null : lines.join("; ");
};
