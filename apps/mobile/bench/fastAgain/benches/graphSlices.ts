/** Measure the actual shared graph's three segments around its production yield boundaries. */
import assert from "node:assert/strict";
import type { ArtistGraph } from "@wave/core";
import * as Effect from "effect/Effect";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { setImmediate } from "node:timers/promises";
import { traceQueries } from "../../../src/library/db/testDatabase.ts";
import { loadLibraryStore } from "../store.ts";
import { percentiles } from "../measure.ts";
import type { FastAgainBench } from "../types.ts";

const key = (graph: ArtistGraph) =>
  createHash("sha256")
    .update(
      JSON.stringify({
        edges: [...graph.edges].map(([k, v]) => [k, [...v]]),
        names: [...graph.names],
      }),
    )
    .digest("hex");

export const bench: FastAgainBench = {
  name: "graphSlices",
  async run(context) {
    const store = await loadLibraryStore(context.root, context.fixture.db);
    if (store.tasteHistory === undefined)
      return [
        {
          read: "coldGraph/productionBoundaries",
          status: "unavailable",
          reason: "Shared Artist graph did not exist",
        },
      ];
    const { readArtistGraph } = await context.loadModule<
      typeof import("../../../src/home/artistGraph.ts")
    >("apps/mobile/src/home/artistGraph.ts");
    const run = async (trace: boolean) => {
      let start = 0;
      let segment = 0;
      const steps: number[] = [];
      const rows: number[] = [];
      const statements: number[] = [];
      const reads = { ...store } as { -readonly [K in keyof typeof store]: (typeof store)[K] };
      if (trace) {
        const note = <A>(read: Effect.Effect<A, unknown>) =>
          Effect.sync(() => {
            const traced = traceQueries(context.fixture.db, () => Effect.runSync(read));
            rows[segment] =
              (rows[segment] ?? 0) + traced.queries.reduce((sum, query) => sum + query.rows, 0);
            statements[segment] = (statements[segment] ?? 0) + traced.queries.length;
            return traced.result;
          });
        if (store.graphPlayPage !== undefined) {
          reads.graphPlayPage = (after) => note(store.graphPlayPage(after)) as never;
          reads.graphCatalogPage = (after) => note(store.graphCatalogPage(after)) as never;
          reads.graphSimilarPage = (after) => note(store.graphSimilarPage(after)) as never;
          reads.graphRadioPage = (after) => note(store.graphRadioPage(after)) as never;
        } else
          for (const name of [
            "candidateCatalog",
            "ytArtistSimilar",
            "tasteHistory",
            "listSongs",
            "listArtists",
          ] as const)
            reads[name] = note(store[name] as Effect.Effect<unknown, unknown>) as never;
      }
      const between = Effect.gen(function* () {
        steps.push(performance.now() - start);
        segment++;
        yield* Effect.promise(() => setImmediate());
        start = performance.now();
      });
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          start = performance.now();
          const graph = yield* readArtistGraph(reads, between);
          steps.push(performance.now() - start);
          return graph;
        }),
      );
      assert.ok(steps.length >= 3);
      return { result, steps, rows, statements };
    };
    const expected = key((await run(false)).result);
    const traced = await run(true);
    const wall: number[] = [];
    const longest: number[] = [];
    const totals: number[] = [];
    const segmentCounts: number[] = [];
    let cpuMicros = 0;
    for (let i = 0; i < context.runs; i++) {
      const cpu = process.cpuUsage();
      const start = performance.now();
      const result = await run(false);
      wall.push(performance.now() - start);
      const used = process.cpuUsage(cpu);
      cpuMicros += used.user + used.system;
      longest.push(Math.max(...result.steps));
      totals.push(result.steps.reduce((a, b) => a + b, 0));
      segmentCounts.push(result.steps.length);
      assert.equal(key(result.result), expected);
    }
    return [
      {
        read: "coldGraph/productionBoundaries",
        ...percentiles(wall),
        cpuMs: Number((cpuMicros / 1000 / context.runs).toFixed(3)),
        rowsRead: traced.rows.reduce((a, b) => a + b, 0),
        statements: traced.statements.reduce((a, b) => a + b, 0),
        notifications: 0,
        longestSyncTaskMs: Number(Math.max(...longest).toFixed(3)),
        resultKey: expected,
        details: {
          source:
            "actual selected-worktree readArtistGraph; historical two hooks or new page/CPU yields",
          caveat:
            "Node setImmediate substitutes for freeTurnEffect; excludes scheduler waits, React and native frames",
          synchronousTotalMs: percentiles(totals),
          longestTaskMs: percentiles(longest),
          steps: segmentCounts,
          maxRowsInStep: Math.max(0, ...traced.rows),
          maxStatementsInStep: Math.max(0, ...traced.statements),
          semanticEquality:
            "complete ordered edge maps, weights and names; cross-revision resultKey asserted by runner",
        },
      },
    ];
  },
};
