import { performance } from "node:perf_hooks";
import { percentiles } from "../measure.ts";
import { createPlaylistReplay } from "../playlistReplay.ts";
import type { BenchMeasurement, FastAgainBench } from "../types.ts";

export const bench: FastAgainBench = {
  name: "playlistRenewal",
  async run(context) {
    const results: BenchMeasurement[] = [];
    for (const mounted of [1, 2]) {
      const read = `trackChange/${mounted}Mounted`;
      const replay = await createPlaylistReplay(context.root, context.fixture);
      if (replay === null) {
        results.push({
          read,
          status: "unavailable",
          reason: "Playlist recommendations did not exist",
        });
        continue;
      }
      try {
        for (let i = 0; i < mounted; i++) await replay.mount();
        const identities = await replay.change(true);
        const work = { ...replay.work };
        const wall: number[] = [];
        const cpu = process.cpuUsage();
        for (let i = 0; i < context.runs; i++) {
          const start = performance.now();
          await replay.change(false);
          wall.push(performance.now() - start);
        }
        const used = process.cpuUsage(cpu);
        results.push({
          read,
          ...percentiles(wall),
          cpuMs: Number(((used.user + used.system) / 1000 / context.runs).toFixed(3)),
          rowsRead: work.rowsRead,
          statements: work.statements,
          notifications: work.notifications,
          longestSyncTaskMs: Number(Math.max(...wall).toFixed(3)),
          resultKey: JSON.stringify(identities),
          details: {
            source:
              "actual Core session, LibraryStore input and change bus; replay of component's subscription",
            mounted,
            inputReads: work.reads,
            phase: "one unrelated burst track change; sessions retained; warm/null graph",
            caveat:
              "no React/frame measurement; no visibility API in this wiring; excludes graph/cache UI publish",
            longestSyncTask:
              "microtask batch: resolved input Promises and synchronous ranking, no task yield",
          },
        });
      } finally {
        replay.close();
      }
    }
    return results;
  },
};
