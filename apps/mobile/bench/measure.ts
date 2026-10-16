/**
 * What the benches here share: medians, timed runs, and the first line they
 * print, which says the numbers are desktop ones.
 */
import { performance } from "node:perf_hooks";

/** The middle of [samples], to two decimals. */
export const median = (samples: readonly number[]): number => {
  const sorted = samples.toSorted((a, b) => a - b);
  return Number(sorted[Math.floor(sorted.length / 2)]!.toFixed(2));
};

/**
 * [run]'s median wall time over [runs] runs and its mean CPU time (process CPU
 * over every run: Windows counts CPU in 15.6 ms ticks, too coarse for one
 * run), after a warm-up run.
 */
export const timeRuns = (run: () => unknown, runs: number) => {
  run();
  const wall: number[] = [];
  const cpuBefore = process.cpuUsage();
  for (let i = 0; i < runs; i++) {
    const before = performance.now();
    run();
    wall.push(performance.now() - before);
  }
  const cpu = process.cpuUsage(cpuBefore);
  return { ms: median(wall), cpuMs: Number(((cpu.user + cpu.system) / 1_000 / runs).toFixed(2)) };
};

/** Prints a bench's first line, `meta`, with [details] (its runs, its sizes). */
export const printMeta = (details: object): void => {
  console.log(
    JSON.stringify({
      kind: "meta",
      note: "Desktop: Node + sql.js (WebAssembly SQLite), not phone timings.",
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      ...details,
    }),
  );
};
