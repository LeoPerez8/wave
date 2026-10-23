/** Measure the actual shared graph at its production page/CPU yield boundaries. */
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import type { ArtistGraph } from "@wave/core";
import * as Effect from "effect/Effect";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { setImmediate } from "node:timers/promises";
import { traceQueries } from "../../../src/library/db/testDatabase.ts";
import { loadLibraryStore } from "../store.ts";
import { percentiles, timeRuns } from "../measure.ts";
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
    // Populate every graph evidence source identically outside measurement.
    context.fixture.db.transaction((tx) => {
      for (let i = 0; i < 1200; i++) {
        const videoId = `graph-bench-${i}`;
        const song = {
          videoId,
          title: videoId,
          artists: [`Graph Artist ${i % 80}`, `Graph Artist ${(i + 1) % 80}`],
          album: null,
          durationMs: 180000,
          artworkUrl: null,
        };
        tx.run(
          sql`INSERT INTO candidate_songs (video_id,song,first_seen_at,last_seen_at) VALUES (${videoId},${JSON.stringify(song)},0,0)`,
        );
        for (let radio = 0; radio < 2; radio++) {
          const seed = `graph artist ${(i + radio + 2) % 80}`,
            seedName = `Graph Artist ${(i + radio + 2) % 80}`;
          tx.run(
            sql`INSERT INTO candidate_radios (video_id,seed_key,seed_name,last_seen_at) VALUES (${videoId},${seed},${seedName},0)`,
          );
        }
      }
      for (let i = 0; i < 80; i++) {
        const page = {
          name: `Graph Artist ${i}`,
          songs: [],
          similar: [{ name: `Graph Artist ${(i + 3) % 80}`, browseId: `g${i}`, audience: null }],
        };
        tx.run(
          sql`INSERT INTO yt_artists (artist_key,outcome,checked_at,browse_id,page) VALUES (${`graph-${i}`},'found',0,${`g${i}`},${JSON.stringify(page)})`,
        );
      }
    });
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
    const longest: number[] = [];
    const totals: number[] = [];
    const segmentCounts: number[] = [];
    const { wall, cpuMicros } = await timeRuns(
      context.runs,
      () => run(false),
      (result) => {
        longest.push(Math.max(...result.steps));
        totals.push(result.steps.reduce((a, b) => a + b, 0));
        segmentCounts.push(result.steps.length);
        assert.equal(key(result.result), expected);
      },
    );
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
          fixtureSources: {
            catalogSongs: 1200,
            radioRows: 2400,
            savedSimilarPages: 80,
            plays: context.fixture.playEvents,
          },
          source:
            "actual selected-worktree readArtistGraph; historical two hooks or new page/CPU yields",
          caveat:
            "Node setImmediate substitutes for freeTurnEffect; excludes scheduler waits, React and native frames",
          synchronousTotalMs: percentiles(totals),
          longestTaskMs: percentiles(longest),
          steps: segmentCounts,
          maxRowsInStep: traced.rows.reduce((max, rows) => Math.max(max, rows), 0),
          maxStatementsInStep: traced.statements.reduce(
            (max, statements) => Math.max(max, statements),
            0,
          ),
          semanticEquality:
            "complete ordered edge maps, weights and names; cross-revision resultKey asserted by runner",
        },
      },
    ];
  },
};
