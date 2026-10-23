/** Shared measurement for #599's desktop replay; never a native frame estimate. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { percentiles } from "./measure.ts";
import type { createPlaylistReplay } from "./playlistReplay.ts";
import type { ReadMeasurement } from "./types.ts";

type Replay = NonNullable<Awaited<ReturnType<typeof createPlaylistReplay>>>;
const canonical = (value: unknown): unknown =>
  value instanceof Set
    ? [...value]
    : Array.isArray(value)
      ? value.map(canonical)
      : value !== null && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .toSorted(([a], [b]) => a.localeCompare(b))
              .map(([k, v]) => [k, canonical(v)]),
          )
        : value;
export const playlistKey = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");

export const measurePlaylistOperation = async (
  read: string,
  runs: number,
  replay: Replay,
  action: () => Promise<unknown>,
  prepare: () => Promise<void> = async () => {},
): Promise<ReadMeasurement> => {
  const run = async (trace: boolean) => {
    await prepare();
    replay.begin(trace);
    const cpu = process.cpuUsage(),
      start = performance.now();
    const value = await action();
    await replay.end();
    const used = process.cpuUsage(cpu);
    const elapsed = performance.now() - start;
    return {
      key: playlistKey(value),
      elapsed,
      cpu: (used.user + used.system) / 1000,
      work: { ...replay.work },
      tasks: [...replay.tasks],
      rows: [...replay.taskRows],
      statements: [...replay.taskStatements],
    };
  };
  const warm = await run(false);
  const traced = await run(true);
  assert.equal(traced.key, warm.key, `${read}: warmup differs`);
  const wall: number[] = [],
    cpu: number[] = [],
    longest: number[] = [],
    totals: number[] = [],
    counts: number[] = [];
  for (let i = 0; i < runs; i++) {
    const sample = await run(false);
    assert.equal(sample.key, traced.key, `${read}: timed result differs`);
    wall.push(sample.elapsed);
    cpu.push(sample.cpu);
    longest.push(Math.max(0, ...sample.tasks));
    totals.push(sample.tasks.reduce((a, b) => a + b, 0));
    counts.push(sample.tasks.length);
  }
  return {
    read,
    ...percentiles(wall),
    cpuMs: Number((cpu.reduce((a, b) => a + b, 0) / runs).toFixed(3)),
    rowsRead: traced.work.rowsRead,
    statements: traced.work.statements,
    notifications: traced.work.notifications,
    longestSyncTaskMs: Number(Math.max(...longest).toFixed(3)),
    resultKey: traced.key,
    details: {
      inputReads: traced.work.reads,
      ranks: traced.work.ranks,
      source:
        "actual selected-revision Core/session/store; current production source/visit seams or faithful ti component bus wiring",
      elapsedReplayMs: percentiles(wall),
      synchronousTotalMs: percentiles(totals),
      longestTaskSamplesMs: longest.map((x) => Number(x.toFixed(3))),
      taskCounts: counts,
      maxRowsInStep: Math.max(0, ...traced.rows),
      maxStatementsInStep: Math.max(0, ...traced.statements),
      caveat:
        "Desktop Node + sql.js; setImmediate replaces free-turn waits; burst throttle/settlement waits driven explicitly; excludes React/map publication, Android/Hermes, native frames and TalkBack",
      equality:
        "complete five slot tracks and order (keys excluded), complete scores in rank probes; opening compares own playlist content while offers are deliberately deferred",
    },
  };
};
