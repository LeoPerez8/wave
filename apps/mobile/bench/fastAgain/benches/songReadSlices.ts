/** #596 experiment: actual SongRow projection, keyset pages, a real task yield per page. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { setImmediate } from "node:timers/promises";
import { asc, gt } from "drizzle-orm";
import * as Effect from "effect/Effect";

import { traceQueries } from "../../../src/library/db/testDatabase.ts";
import { percentiles, timeRuns } from "../measure.ts";
import { loadLibraryStore } from "../store.ts";
import type { FastAgainBench, ReadMeasurement } from "../types.ts";

const key = (ids: readonly number[]): string =>
  createHash("sha256")
    .update(JSON.stringify(ids.toSorted((a, b) => a - b)))
    .digest("hex");
const round = (n: number): number => Number(n.toFixed(3));

export const bench: FastAgainBench = {
  name: "songReadSlices",
  async run(context) {
    const store = await loadLibraryStore(context.root, context.fixture.db);
    const tracksModule = await context.loadModule<
      typeof import("../../../src/library/db/tracks.ts")
    >("apps/mobile/src/library/db/tracks.ts");
    const schema = await context.loadModule<typeof import("../../../src/library/db/schema.ts")>(
      "apps/mobile/src/library/db/schema.ts",
    );
    const full = Effect.runSync(store.listSongs);
    const expected = key(full.map((row) => row.id));
    const results: ReadMeasurement[] = [
      context.measure("fullSongRows", () => Effect.runSync(store.listSongs), {
        resultKey: (rows) => key(rows.map((row) => row.id)),
        details: { source: "actual LibraryStore.listSongs; single synchronous operation" },
      }),
    ];
    for (const limit of [50, 100, 250]) {
      const page = (cursor: number) =>
        tracksModule
          .trackQuery(context.fixture.db)
          .where(gt(schema.tracks.id, cursor))
          .orderBy(asc(schema.tracks.id))
          .limit(limit)
          .all();
      const run = async (trace: boolean) => {
        const ids: number[] = [];
        let cursor = 0;
        let statements = 0;
        let rowsRead = 0;
        const steps: number[] = [];
        while (true) {
          const start = performance.now();
          const read = trace ? traceQueries(context.fixture.db, () => page(cursor)) : null;
          const rows = read === null ? page(cursor) : read.result;
          for (const row of rows) ids.push(row.id);
          if (rows.length > 0) cursor = rows.at(-1)!.id;
          steps.push(performance.now() - start);
          if (read !== null) {
            statements += read.queries.length;
            rowsRead += read.queries.reduce((sum, query) => sum + query.rows, 0);
          }
          if (rows.length < limit) break;
          await setImmediate();
        }
        return { ids, statements, rowsRead, steps };
      };
      await run(false);
      const traced = await run(true);
      assert.equal(key(traced.ids), expected, "keyset projection lost or duplicated songs");
      const steps: number[] = [];
      const { wall, cpuMicros } = await timeRuns(
        context.runs,
        () => run(false),
        (result) => {
          steps.push(...result.steps);
          assert.equal(key(result.ids), expected);
        },
      );
      results.push({
        read: `keysetSongRows/${limit}`,
        ...percentiles(wall),
        cpuMs: round(cpuMicros / 1000 / context.runs),
        rowsRead: traced.rowsRead,
        statements: traced.statements,
        longestSyncTaskMs: round(Math.max(...steps)),
        notifications: 0,
        resultKey: expected,
        details: {
          source:
            "actual worktree trackQuery + schema; experimental id > cursor, ORDER BY id, LIMIT",
          phase:
            "complete Library traversal, setImmediate between pages; all SongRow fields decoded",
          stepMedianMs: percentiles(steps).medianMs,
          stepP90Ms: percentiles(steps).p90Ms,
          caveat:
            "identity-set equivalence only; traversal order differs from title order; not a production adapter",
          notifications: "read-only queries; no subscriber writes",
        },
      });
    }
    return results;
  },
};
