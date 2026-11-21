import { SLOW_READ_BUDGET_MS, slowReadsLine, type SlowRead } from "@wave/core";

/** Read results are lists, single rows/scalars, or named bundles with an explicit counter. */
const libraryReadRows = (result: unknown): number => {
  if (result === null || result === undefined) return 0;
  if (Array.isArray(result)) return result.length;
  if (result instanceof Map || result instanceof Set) return result.size;
  return 1;
};

interface ReadTimingOptions {
  readonly now: () => number;
  readonly route: () => string;
  readonly write: (line: string) => void;
  /** Schedules one flush and returns its cancellation. */
  readonly schedule: (flush: () => void, delayMs: number) => () => void;
  readonly onSlowRead?: (read: SlowRead) => void;
}

/**
 * The store's read boundary: `read` times a read run on the JS thread, `held`
 * takes the JS time an off-thread read measured itself (#1348). Fast reads take just two timestamps and
 * a budget comparison: no route lookup, row inspection, allocation or timer.
 * Slow completions in one second share one entry, even during continuous work.
 */
export const createLibraryReadTiming = (options: ReadTimingOptions) => {
  let pending: SlowRead[] = [];
  let groupStartedAt = -Infinity;
  let cancel: (() => void) | undefined;

  const flush = (): void => {
    cancel?.();
    cancel = undefined;
    if (pending.length === 0) return;
    const reads = pending;
    pending = [];
    const line = slowReadsLine(reads);
    if (line !== null) options.write(line);
  };

  /** Records a read that held the JS thread for [durationMs], ending now. */
  const held = <A>(
    operation: string,
    durationMs: number,
    result: A | undefined,
    rows: (result: A) => number = libraryReadRows,
  ): void => {
    if (durationMs <= SLOW_READ_BUDGET_MS) return;
    // Diagnostic failures must never turn a successful read into a failed
    // one, nor hide the original database error from Effect's catch.
    try {
      const end = options.now();
      // A synchronous read can keep the timer from running. Separate groups
      // by their timestamps even when the previous timer has not had a turn.
      if (end - groupStartedAt >= 1_000) flush();
      const slow = {
        operation,
        rows: result === undefined ? 0 : rows(result),
        durationMs,
        route: options.route(),
      };
      pending.push(slow);
      if (pending.length === 1) {
        groupStartedAt = end;
        cancel = options.schedule(flush, 1_000);
      }
      options.onSlowRead?.(slow);
    } catch {
      // The app log is best effort, just like its native writer.
    }
  };

  /** Times a synchronous read on the JS thread. */
  const read = <A>(
    operation: string,
    run: () => A,
    rows: (result: A) => number = libraryReadRows,
  ): A => {
    const start = options.now();
    let result: A | undefined;
    try {
      result = run();
      return result;
    } finally {
      const durationMs = options.now() - start;
      if (durationMs > SLOW_READ_BUDGET_MS) held(operation, durationMs, result, rows);
    }
  };

  return { read, held, flush };
};
