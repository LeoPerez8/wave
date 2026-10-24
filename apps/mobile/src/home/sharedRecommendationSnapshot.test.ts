/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  artistNeighbourhood,
  snapshotVersionsAfter,
  type CatalogSong,
  type SnapshotSource,
  type SnapshotVersions,
} from "@wave/core";
import * as Effect from "effect/Effect";

import type { ArtistGraphReads } from "./artistGraph.ts";
import { shareRecommendationSnapshot } from "./sharedRecommendationSnapshot.ts";

const song = (videoId: string, artist: string, seed: string): CatalogSong => ({
  song: {
    videoId,
    title: videoId,
    artists: [artist],
    album: null,
    albumId: null,
    durationMs: null,
    artworkUrl: null,
    explicit: false,
  },
  firstSeenAt: 0,
  lastSeenAt: 0,
  radios: [{ seed: seed.toLowerCase(), seedName: seed, lastSeenAt: 0 }],
});

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * The snapshot over counting reads: the Library and the catalog each count
 * as one read, the graph counts its play-history reads, and [hold] keeps the
 * graph's play page open until released.
 */
const fixture = (catalog: CatalogSong[] = [song("p1", "Portishead", "Massive Attack")]) => {
  const reads = { library: 0, catalog: 0, graphPlays: 0, graphCatalog: 0 };
  let versions: SnapshotVersions = {};
  let held: (() => void) | null = null;
  let hold = false;
  const graphStore: ArtistGraphReads = {
    graphCatalogPage: () =>
      Effect.sync(() => {
        reads.graphCatalog++;
        return { rows: [], next: null };
      }),
    graphRadioPage: () =>
      Effect.sync(() => {
        reads.graphCatalog++;
        return { rows: [], next: null };
      }),
    graphSimilarPage: () => Effect.succeed({ rows: [], next: null }),
    graphPlayPage: () =>
      Effect.suspend(() => {
        reads.graphPlays++;
        const page = {
          rows: [
            {
              startedAt: 0,
              listenedMs: 180_000,
              endReason: "completed" as const,
              artists: ["Massive Attack"],
            },
          ],
          next: null,
        };
        if (!hold) return Effect.succeed(page);
        return Effect.callback<typeof page>((resume) => {
          held = () => resume(Effect.succeed(page));
        });
      }),
  };
  const snapshot = shareRecommendationSnapshot({
    library: Effect.sync(() => ({ read: ++reads.library })),
    catalog: Effect.sync(() => {
      reads.catalog++;
      return catalog;
    }),
    graph: { store: Effect.succeed(graphStore), start: Effect.void, between: Effect.void },
    versions: () => versions,
  });
  return {
    snapshot,
    reads,
    write: (source: SnapshotSource) => {
      versions = snapshotVersionsAfter(versions, source);
    },
    hold: () => {
      hold = true;
    },
    release: () => {
      hold = false;
      held?.();
      held = null;
    },
  };
};

describe("the shared recommendation snapshot", () => {
  test("Home mixes, the Magic Queue radio, playlist suggestions and the harvest read the Library, the catalog and the graph once", async () => {
    const { snapshot, reads } = fixture();
    const surfaces = await Promise.all(
      ["mixes", "radio", "suggestions", "harvest"].map(() => Effect.runPromise(snapshot.get)),
    );
    surfaces.push(await Effect.runPromise(snapshot.get));
    assert.deepEqual(reads, { library: 1, catalog: 1, graphPlays: 1, graphCatalog: 0 });
    for (const surface of surfaces) {
      assert.equal(surface.library, surfaces[0]!.library);
      assert.equal(surface.catalog, surfaces[0]!.catalog);
      assert.equal(surface.graph, surfaces[0]!.graph);
    }
    assert.deepEqual(
      artistNeighbourhood(surfaces[0]!.graph, ["Massive Attack"]).map(({ name }) => name),
      ["Portishead"],
      "the graph is derived from the shared catalog's radios",
    );
    snapshot.dispose();
  });

  test("a song finishing while the graph builds doesn't rebuild it; the next ask reads the plays again", async () => {
    const { snapshot, reads, write, hold, release } = fixture();
    hold();
    const building = Effect.runPromise(snapshot.graph);
    await turn();
    assert.equal(reads.graphPlays, 1);
    write("plays");
    const radio = Effect.runPromise(snapshot.graph);
    await turn();
    assert.equal(reads.graphPlays, 1, "nothing rebuilds while the graph is built");
    release();
    const built = await building;
    const next = await radio;
    assert.notEqual(next, built, "the ask after the song reads it");
    assert.equal(reads.graphPlays, 2);
    assert.equal(reads.catalog, 1, "a play doesn't reach the catalog");
    snapshot.dispose();
  });

  test("a harvest batch written while recommendations read doesn't restart them; the next ask reads the catalog and graph again", async () => {
    const { snapshot, reads, write, hold, release } = fixture();
    hold();
    const mixes = Effect.runPromise(snapshot.get);
    await turn();
    write("catalog");
    release();
    const first = await mixes;
    assert.deepEqual(reads, { library: 1, catalog: 1, graphPlays: 1, graphCatalog: 0 });
    const harvest = await Effect.runPromise(snapshot.get);
    assert.equal(harvest.library, first.library, "a catalog write doesn't reach the Library");
    assert.notEqual(harvest.graph, first.graph);
    assert.deepEqual(reads, { library: 1, catalog: 2, graphPlays: 2, graphCatalog: 0 });
    snapshot.dispose();
  });

  test("a harvest batch written while the catalog is read leaves one get's catalog and graph from the same read", async () => {
    let versions: SnapshotVersions = {};
    let catalogReads = 0;
    const store: ArtistGraphReads = {
      graphCatalogPage: () => Effect.succeed({ rows: [], next: null }),
      graphRadioPage: () => Effect.succeed({ rows: [], next: null }),
      graphSimilarPage: () => Effect.succeed({ rows: [], next: null }),
      graphPlayPage: () => Effect.succeed({ rows: [], next: null }),
    };
    const snapshot = shareRecommendationSnapshot({
      library: Effect.succeed({}),
      catalog: Effect.sync(() => {
        catalogReads++;
        if (catalogReads > 1) return [song("t1", "Tricky", "Massive Attack")];
        versions = snapshotVersionsAfter(versions, "catalog");
        return [song("p1", "Portishead", "Massive Attack")];
      }),
      graph: { store: Effect.succeed(store), start: Effect.void, between: Effect.void },
      versions: () => versions,
    });
    const neighbours = (read: Effect.Success<typeof snapshot.get>) => ({
      catalog: read.catalog.map((entry) => entry.song.artists[0]),
      graph: artistNeighbourhood(read.graph, ["Massive Attack"]).map(({ name }) => name),
    });
    const mixes = await Effect.runPromise(snapshot.get);
    assert.deepEqual(neighbours(mixes), { catalog: ["Portishead"], graph: ["Portishead"] });
    assert.equal(catalogReads, 1, "the catalog is paged once for both");
    const next = await Effect.runPromise(snapshot.get);
    assert.deepEqual(neighbours(next), { catalog: ["Tricky"], graph: ["Tricky"] });
    assert.equal(catalogReads, 2, "the ask after the batch reads it");
    snapshot.dispose();
  });
});
