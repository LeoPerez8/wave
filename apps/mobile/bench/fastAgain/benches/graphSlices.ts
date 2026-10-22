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
    .update(JSON.stringify([...graph.edges].map(([k, v]) => [k, [...v]])))
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
      const rows = [0, 0, 0];
      const statements = [0, 0, 0];
      const reads = { ...store } as { -readonly [K in keyof typeof store]: (typeof store)[K] };
      if (trace)
        for (const name of [
          "candidateCatalog",
          "ytArtistSimilar",
          "tasteHistory",
          "listSongs",
          "listArtists",
        ] as const) {
          reads[name] = Effect.sync(() => {
            const traced = traceQueries(context.fixture.db, () =>
              Effect.runSync(store[name] as Effect.Effect<unknown, unknown>),
            );
            rows[segment]! += traced.queries.reduce((sum, query) => sum + query.rows, 0);
            statements[segment]! += traced.queries.length;
            return traced.result;
          }) as never;
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
      assert.equal(steps.length, 3);
      return { result, steps, rows, statements };
    };
    const expected = key((await run(false)).result);
    const traced = await run(true);
    const wall: number[] = [];
    const segments: number[][] = [[], [], []];
    let cpuMicros = 0;
    for (let i = 0; i < context.runs; i++) {
      const cpu = process.cpuUsage();
      const start = performance.now();
      const result = await run(false);
      wall.push(performance.now() - start);
      const used = process.cpuUsage(cpu);
      cpuMicros += used.user + used.system;
      result.steps.forEach((ms, index) => segments[index]!.push(ms));
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
        longestSyncTaskMs: Number(Math.max(...segments.flat()).toFixed(3)),
        resultKey: expected,
        details: {
          source:
            "actual readArtistGraph with real setImmediate at its two production between hooks",
          caveat:
            "Node task yields substitute for freeTurnEffect's waits; excludes scheduler waiting and React",
          segments: segments.map((times, index) => ({
            ...percentiles(times),
            rowsRead: traced.rows[index],
            statements: traced.statements[index],
          })),
        },
      },
    ];
  },
};
