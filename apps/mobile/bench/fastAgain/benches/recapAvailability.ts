import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import * as Effect from "effect/Effect";
import { recapToAnnounce } from "@wave/core";
import { createRecapReplay } from "../recapReplay.ts";
import { percentiles } from "../measure.ts";
import type { FastAgainBench, BenchMeasurement } from "../types.ts";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const round = (value: number) => Number(value.toFixed(3));
const scenarios = ["cold", "unchangedReturn", "historyChanged", "calendarBoundary"] as const;
export const bench: FastAgainBench = {
  name: "recapAvailability",
  async run(context) {
    const probe = await createRecapReplay(context.root, context.fixture);
    if (probe === null)
      return scenarios.map((read) => ({
        read,
        status: "unavailable",
        reason: "This revision predates Home Recaps and Stats.recaps",
      }));
    probe.close();
    const measurements: BenchMeasurement[] = [];
    let historyChanges = 0;
    const { fixture } = context;
    const prepare = async (scenario: (typeof scenarios)[number]) => {
      const replay = (await createRecapReplay(context.root, fixture))!;
      const client = replay.attach(false);
      if (scenario !== "cold") {
        client.setActive(true);
        await replay.drain();
        client.setActive(false);
        if (scenario === "historyChanged") {
          // Actual persisted progress changes alternate by one ms; no fixture growth or availability change.
          Effect.runSync(
            replay.store.updatePlay(1, {
              trackId: String(fixture.songIds[0]),
              context: null,
              startedAt: fixture.now - 90 * 86400000,
              listenedMs: 180000 + (historyChanges++ % 2),
              durationMs: 180001,
              endReason: "completed",
              counted: true,
              source: "phone",
            }),
          );
          replay.invalidate();
        }
        if (scenario === "calendarBoundary") {
          const date = new Date(fixture.now);
          replay.at(new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime());
        }
      }
      return { replay, client };
    };
    for (const scenario of scenarios) {
      const run = async (trace: boolean) => {
        const { replay, client } = await prepare(scenario);
        replay.reset(trace);
        const cpu = process.cpuUsage();
        const start = performance.now();
        client.setActive(true);
        const activationMs = performance.now() - start;
        await replay.drain();
        const elapsedMs = performance.now() - start;
        const used = process.cpuUsage(cpu);
        const recaps = replay.get()!;
        assert.ok(recaps);
        // Compare every available period and all opened-state announcements, not only a count/id.
        const key = hash({
          recaps,
          announcements: [
            [],
            ...recaps.map((period) => [
              period.kind === "year"
                ? String(period.year)
                : `${period.year}-${String(period.month).padStart(2, "0")}`,
            ]),
            recaps.map((period) =>
              period.kind === "year"
                ? String(period.year)
                : `${period.year}-${String(period.month).padStart(2, "0")}`,
            ),
          ].map((opened) => recapToAnnounce(recaps, opened)),
        });
        const tasks = [activationMs, ...replay.tasks()];
        const result = {
          key,
          elapsedMs,
          cpuMs: (used.user + used.system) / 1000,
          totalMs: tasks.reduce((sum, ms) => sum + ms, 0),
          longestMs: Math.max(...tasks),
          tasks: tasks.length,
          work: { ...replay.work },
          queries: replay.queries(),
          bounded: replay.bounded,
        };
        replay.close();
        return result;
      };
      await run(false); // Warm selected modules and SQLite; each measured cold case still uses a fresh cache.
      const traced = await run(true);
      const samples = [];
      for (let i = 0; i < context.runs; i++) {
        const sample = await run(false);
        assert.equal(sample.key, traced.key);
        samples.push(sample);
      }
      measurements.push({
        read: scenario,
        ...percentiles(samples.map((s) => s.elapsedMs)),
        cpuMs: round(samples.reduce((sum, s) => sum + s.cpuMs, 0) / samples.length),
        rowsRead: traced.work.rowsRead,
        statements: traced.work.statements,
        longestSyncTaskMs: round(Math.max(...samples.map((s) => s.longestMs))),
        notifications: traced.work.notifications,
        resultKey: traced.key,
        details: {
          source:
            "actual selected-worktree Stats + LibraryStore; production shareRecapAvailability when present; historical useStatsRead focus replay otherwise",
          totalSynchronousJsMs: percentiles(samples.map((s) => s.totalMs)),
          elapsedReplayMs: percentiles(samples.map((s) => s.elapsedMs)),
          longestTaskSamplesMs: samples.map((s) => round(s.longestMs)),
          taskCounts: samples.map((s) => s.tasks),
          maxRowsPerStatement: traced.work.maxRows,
          refreshes: traced.work.reads,
          bounded: traced.bounded,
          sourceRows: fixture.playEvents,
          notificationScope:
            "one subscribed availability consumer; equal refreshed periods retain snapshot in the fixed cache",
          semantics:
            "all ordered Recap periods and announcement for none/each individual/all opened ids; cross-variant SHA-256 comparison",
          clock:
            "fixture October 1, next local month for calendarBoundary; controlled wall/monotonic clocks; mutation and warmup excluded",
          tasksScope:
            "activation and actual SQL/derivation segments split by injected setImmediate free turns; elapsed/CPU include cache publication and promise bookkeeping",
          omissions:
            "React/native frames, phone SQLite/Hermes, animation/quiet waits and TalkBack; no native timing is inferred",
        },
      });
    }
    return measurements;
  },
};
